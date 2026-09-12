import type { TradeEvent } from "./types.js";

export interface EvmEventLog {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  chain: string;
  timestamp: number;
  blockNumber?: number;
}

export interface SwapToken {
  address: string;
  symbol?: string;
  decimals: number;
}

export interface DecodedSwap {
  protocol: SupportedDexProtocol;
  poolAddress: string;
  chain: string;
  transactionHash: string;
  timestamp: number;
  blockNumber?: number;
  walletAddress: string;
  assetIn: SwapToken;
  amountInBaseUnits: string;
  assetOut: SwapToken;
  amountOutBaseUnits: string;
}

export type SupportedDexProtocol = "uniswap-v2";

export interface DexSwapAdapter {
  readonly protocol: SupportedDexProtocol;
  readonly eventSignature: string;
  decode(log: EvmEventLog, walletAddress: string): DecodedSwap | null;
}

export interface UniswapV2AdapterOptions {
  poolAddress: string;
  token0: SwapToken;
  token1: SwapToken;
}

export const UNISWAP_V2_SWAP_TOPIC =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

export const SUPPORTED_SWAP_EVENT_SIGNATURES: Readonly<Record<SupportedDexProtocol, string>> = {
  "uniswap-v2": "Swap(address,uint256,uint256,uint256,uint256,address)",
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function decodeWords(data: string): bigint[] | null {
  if (!/^0x(?:[0-9a-fA-F]{64})*$/.test(data)) return null;
  const body = data.slice(2);
  if (body.length !== 256) return null;
  return Array.from({ length: 4 }, (_, index) => BigInt(`0x${body.slice(index * 64, (index + 1) * 64)}`));
}

function token(token: SwapToken): SwapToken {
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) {
    throw new Error(`Invalid token decimals for ${token.address}`);
  }
  return { ...token, address: normalizeAddress(token.address) };
}

export class UniswapV2SwapAdapter implements DexSwapAdapter {
  readonly protocol = "uniswap-v2" as const;
  readonly eventSignature = SUPPORTED_SWAP_EVENT_SIGNATURES["uniswap-v2"];
  private readonly poolAddress: string;
  private readonly token0: SwapToken;
  private readonly token1: SwapToken;

  constructor(options: UniswapV2AdapterOptions) {
    this.poolAddress = normalizeAddress(options.poolAddress);
    this.token0 = token(options.token0);
    this.token1 = token(options.token1);
  }

  decode(log: EvmEventLog, walletAddress: string): DecodedSwap | null {
    if (
      normalizeAddress(log.address) !== this.poolAddress ||
      log.topics[0]?.toLowerCase() !== UNISWAP_V2_SWAP_TOPIC ||
      log.topics.length < 3
    ) return null;
    const sender = topicAddress(log.topics[1]);
    const recipient = topicAddress(log.topics[2]);
    const wallet = normalizeAddress(walletAddress);
    if (sender !== wallet && recipient !== wallet) return null;
    const words = decodeWords(log.data);
    if (!words) return null;
    const [amount0In, amount1In, amount0Out, amount1Out] = words;
    if (amount0In === undefined || amount1In === undefined || amount0Out === undefined || amount1Out === undefined) return null;
    const inputToken = amount0In > 0n ? this.token0 : amount1In > 0n ? this.token1 : null;
    const inputAmount = amount0In > 0n ? amount0In : amount1In > 0n ? amount1In : null;
    const outputToken = amount0Out > 0n ? this.token0 : amount1Out > 0n ? this.token1 : null;
    const outputAmount = amount0Out > 0n ? amount0Out : amount1Out > 0n ? amount1Out : null;
    if (!inputToken || inputAmount === null || !outputToken || outputAmount === null || inputToken.address === outputToken.address) return null;
    return {
      protocol: this.protocol,
      poolAddress: this.poolAddress,
      chain: log.chain,
      transactionHash: log.transactionHash,
      timestamp: log.timestamp,
      ...(log.blockNumber === undefined ? {} : { blockNumber: log.blockNumber }),
      walletAddress: wallet,
      assetIn: inputToken,
      amountInBaseUnits: inputAmount.toString(),
      assetOut: outputToken,
      amountOutBaseUnits: outputAmount.toString(),
    };
  }
}

export function decodeDexSwapLogs(
  logs: EvmEventLog[],
  adapters: readonly DexSwapAdapter[],
  walletAddress: string,
): DecodedSwap[] {
  return logs
    .flatMap((log) => adapters.flatMap((adapter) => {
      const decoded = adapter.decode(log, walletAddress);
      return decoded ? [decoded] : [];
    }))
    .sort((left, right) =>
      left.timestamp - right.timestamp ||
      left.transactionHash.localeCompare(right.transactionHash) ||
      left.poolAddress.localeCompare(right.poolAddress),
    );
}

export interface HistoricalPriceRequest {
  assetAddress: string;
  chain: string;
  timestamp: number;
  transactionHash: string;
}

export interface HistoricalPriceProvider {
  getUsdPrice(request: HistoricalPriceRequest): Promise<number | undefined>;
}

export interface PricedSwapResult {
  events: TradeEvent[];
  warnings: string[];
}

function baseUnitsToNumber(amount: string, decimals: number): number {
  const value = Number(amount) / 10 ** decimals;
  return Number.isFinite(value) ? value : Number.NaN;
}

export async function priceDecodedSwaps(
  swaps: readonly DecodedSwap[],
  provider: HistoricalPriceProvider,
): Promise<PricedSwapResult> {
  const events: TradeEvent[] = [];
  const warnings: string[] = [];
  for (const swap of swaps) {
    const [inputPrice, outputPrice] = await Promise.all([
      provider.getUsdPrice({
        assetAddress: swap.assetIn.address,
        chain: swap.chain,
        timestamp: swap.timestamp,
        transactionHash: swap.transactionHash,
      }),
      provider.getUsdPrice({
        assetAddress: swap.assetOut.address,
        chain: swap.chain,
        timestamp: swap.timestamp,
        transactionHash: swap.transactionHash,
      }),
    ]);
    if (inputPrice === undefined || outputPrice === undefined) {
      warnings.push(`Missing historical USD price for swap ${swap.transactionHash}; swap excluded from PnL`);
      continue;
    }
    const inputQuantity = baseUnitsToNumber(swap.amountInBaseUnits, swap.assetIn.decimals);
    const outputQuantity = baseUnitsToNumber(swap.amountOutBaseUnits, swap.assetOut.decimals);
    if (!Number.isFinite(inputQuantity) || !Number.isFinite(outputQuantity)) {
      warnings.push(`Invalid token decimals or amount for swap ${swap.transactionHash}; swap excluded from PnL`);
      continue;
    }
    events.push(
      { asset: swap.assetIn.address, assetType: "token", side: "sell", quantity: inputQuantity, unitPriceUsd: inputPrice, timestamp: swap.timestamp, transactionHash: swap.transactionHash },
      { asset: swap.assetOut.address, assetType: "token", side: "buy", quantity: outputQuantity, unitPriceUsd: outputPrice, timestamp: swap.timestamp, transactionHash: swap.transactionHash },
    );
  }
  return { events, warnings };
}
