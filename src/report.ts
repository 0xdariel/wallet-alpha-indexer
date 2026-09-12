import { ERC20_TRANSFER_TOPIC, type RpcDataProvider } from "./ingestion/rpc.js";
import { TokenMetadataCache } from "./metadata.js";
import { calculateFifoPnl } from "./pnl.js";
import {
  UNISWAP_V2_SWAP_TOPIC,
  decodeDexSwapLogs,
  priceDecodedSwaps,
  type DecodedSwap,
  type DexSwapAdapter,
  type EvmEventLog,
  type HistoricalPriceProvider,
} from "./swaps.js";
import type { PnlResult } from "./types.js";

const MAX_REPORT_BLOCKS = 10_000;

export interface WalletPnlReportProvider extends RpcDataProvider {}

export interface WalletPnlReportRequest {
  walletAddress: string;
  chain: string;
  fromBlock: number;
  toBlock: number;
  provider: WalletPnlReportProvider;
  adapters: readonly DexSwapAdapter[];
  metadata: TokenMetadataCache;
  prices: HistoricalPriceProvider;
}

export interface WalletPnlReport {
  walletAddress: string;
  chain: string;
  fromBlock: number;
  toBlock: number;
  tradeCount: number;
  winRate?: number;
  realizedPnlUsd: number;
  costBasisUsd: number;
  proceedsUsd: number;
  holdings: PnlResult["openPositions"];
  unrealizedPnlUsd?: number;
  limitations: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
}

function validateRange(fromBlock: number, toBlock: number): void {
  if (
    !Number.isSafeInteger(fromBlock) ||
    !Number.isSafeInteger(toBlock) ||
    fromBlock < 0 ||
    toBlock < fromBlock ||
    toBlock - fromBlock + 1 > MAX_REPORT_BLOCKS
  ) {
    throw new Error(`Report block range must be bounded to ${MAX_REPORT_BLOCKS} blocks`);
  }
}

function blockNumber(value: string): number {
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result)) throw new Error(`RPC block number exceeds safe integer range: ${value}`);
  return result;
}

function eventLog(log: Awaited<ReturnType<RpcDataProvider["getLogs"]>>[number], timestamps: Map<number, number>, chain: string): EvmEventLog | null {
  const number = blockNumber(log.blockNumber);
  const timestamp = timestamps.get(number);
  if (timestamp === undefined) return null;
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    transactionHash: log.transactionHash,
    chain,
    timestamp,
    blockNumber: number,
  };
}

async function resolveSwapMetadata(
  swaps: readonly DecodedSwap[],
  metadata: TokenMetadataCache,
): Promise<{ swaps: DecodedSwap[]; warnings: string[] }> {
  const addresses = [...new Set(swaps.flatMap((swap) => [swap.assetIn.address, swap.assetOut.address]))].sort();
  const resolved = new Map<string, Awaited<ReturnType<TokenMetadataCache["get"]>>>();
  await Promise.all(addresses.map(async (address) => resolved.set(address, await metadata.get(address))));
  const warnings: string[] = [];
  const enriched: DecodedSwap[] = [];
  for (const swap of swaps) {
    const input = resolved.get(swap.assetIn.address);
    const output = resolved.get(swap.assetOut.address);
    if (input?.decimals === undefined || output?.decimals === undefined) {
      warnings.push(`Missing token decimals for swap ${swap.transactionHash}; swap excluded from PnL`);
      continue;
    }
    enriched.push({
      ...swap,
      assetIn: { ...swap.assetIn, ...(input.symbol ? { symbol: input.symbol } : {}), decimals: input.decimals },
      assetOut: { ...swap.assetOut, ...(output.symbol ? { symbol: output.symbol } : {}), decimals: output.decimals },
    });
  }
  return { swaps: enriched, warnings };
}

function confidence(warnings: readonly string[], tradeCount: number): WalletPnlReport["confidence"] {
  if (warnings.length === 0 && tradeCount > 0) return "high";
  if (tradeCount > 0 && warnings.every((warning) => warning.includes("Generic token transfers"))) return "medium";
  return "low";
}

function isWalletTransfer(
  log: Awaited<ReturnType<RpcDataProvider["getLogs"]>>[number],
  walletAddress: string,
): boolean {
  if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC || log.topics.length < 3) return false;
  const from = log.topics[1]?.slice(-40).toLowerCase();
  const to = log.topics[2]?.slice(-40).toLowerCase();
  return from === walletAddress.slice(2) || to === walletAddress.slice(2);
}

export async function buildWalletPnlReport(request: WalletPnlReportRequest): Promise<WalletPnlReport> {
  validateRange(request.fromBlock, request.toBlock);
  const walletAddress = request.walletAddress.toLowerCase();
  const blocks = await Promise.all(
    Array.from({ length: request.toBlock - request.fromBlock + 1 }, (_, index) =>
      request.provider.getBlock(request.fromBlock + index),
    ),
  );
  const timestamps = new Map<number, number>();
  let missingBlockCount = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) {
      missingBlockCount += 1;
      continue;
    }
    timestamps.set(blockNumber(block.number), blockNumber(block.timestamp));
  }
  const [swapLogs, transferLogs] = await Promise.all([
    request.adapters.length === 0
      ? Promise.resolve([])
      : request.provider.getLogs(request.fromBlock, request.toBlock, undefined, UNISWAP_V2_SWAP_TOPIC),
    request.provider.getLogs(request.fromBlock, request.toBlock, undefined, ERC20_TRANSFER_TOPIC),
  ]);
  const logs = swapLogs
    .map((log) => eventLog(log, timestamps, request.chain))
    .filter((log): log is EvmEventLog => log !== null);
  const decoded = decodeDexSwapLogs(logs, request.adapters, walletAddress);
  const metadataResult = await resolveSwapMetadata(decoded, request.metadata);
  const priced = await priceDecodedSwaps(metadataResult.swaps, request.prices);
  const pnl = calculateFifoPnl(priced.events);
  const warnings = [...metadataResult.warnings, ...priced.warnings, ...pnl.warnings];
  const swapTransactions = new Set(decoded.map((swap) => swap.transactionHash));
  if (transferLogs.some((log) => isWalletTransfer(log, walletAddress) && !swapTransactions.has(log.transactionHash))) {
    warnings.push("Generic token transfers were observed but were not treated as swaps");
  }
  if (missingBlockCount > 0) {
    warnings.push(`Partial RPC data: ${missingBlockCount} block(s) were unavailable; affected logs may be excluded`);
  }
  if (logs.length < swapLogs.length) {
    warnings.push("Partial RPC data: swap logs from unavailable blocks were excluded");
  }
  if (decoded.length === 0) warnings.push("No supported swap events were found in the bounded range");
  const tradeCount = priced.events.length / 2;
  const winCount = metadataResult.swaps
    .filter((swap) => priced.events.some((event) => event.transactionHash === swap.transactionHash))
    .filter((swap) => {
      const input = Number(swap.amountInBaseUnits) / 10 ** swap.assetIn.decimals;
      const output = Number(swap.amountOutBaseUnits) / 10 ** swap.assetOut.decimals;
      return output * (priced.events.find((event) => event.transactionHash === swap.transactionHash && event.side === "buy")?.unitPriceUsd ?? 0) >
        input * (priced.events.find((event) => event.transactionHash === swap.transactionHash && event.side === "sell")?.unitPriceUsd ?? 0);
    }).length;
  const warningsSorted = [...new Set(warnings)].sort();
  return {
    walletAddress,
    chain: request.chain,
    fromBlock: request.fromBlock,
    toBlock: request.toBlock,
    tradeCount,
    ...(tradeCount > 0 ? { winRate: winCount / tradeCount } : {}),
    realizedPnlUsd: pnl.realizedPnlUsd,
    costBasisUsd: pnl.costBasisUsd,
    proceedsUsd: pnl.proceedsUsd,
    holdings: pnl.openPositions,
    limitations: ["Unrealized PnL is not calculated; holdings are open FIFO positions only"],
    warnings: warningsSorted,
    confidence: confidence(warningsSorted, tradeCount),
  };
}

export function serializeWalletPnlReport(report: WalletPnlReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
