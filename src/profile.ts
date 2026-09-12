import type { ChainActivity } from "./ingestion/evm.js";
import type { CandidateMetrics } from "./ingestion/discovery.js";
import type { TokenMetadata, TokenHolding, WalletProfile } from "./types.js";

export interface ProfileOptions {
  nativeBalanceWei?: string;
  discoveryMetrics?: CandidateMetrics;
  metadata?: Map<string, TokenMetadata> | { get(address: string): Promise<TokenMetadata> };
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function decimalBalance(baseUnits: bigint, decimals: number): string {
  const negative = baseUnits < 0n;
  const absolute = negative ? -baseUnits : baseUnits;
  const value = absolute.toString().padStart(decimals + 1, "0");
  const whole = value.slice(0, -decimals || undefined) || "0";
  const fraction = decimals === 0 ? "" : value.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export async function buildWalletProfile(
  address: string,
  activities: ChainActivity[],
  options: ProfileOptions = {},
): Promise<WalletProfile> {
  const normalizedAddress = normalizeAddress(address);
  const transactions = activities.flatMap((activity) => activity.transactions);
  const transfers = activities.flatMap((activity) => activity.tokenTransfers);
  const timestamps = [...transactions.map((item) => item.timestamp), ...transfers.map((item) => item.timestamp)]
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const activeDays = new Set(timestamps.map((timestamp) => new Date(timestamp * 1000).toISOString().slice(0, 10))).size;
  const activeBlocks = new Set([
    ...transactions.map((item) => `${item.chain}:${item.blockNumber ?? item.timestamp}`),
    ...transfers.map((item) => `${item.chain}:${item.blockNumber ?? item.timestamp}`),
  ]).size;
  const balances = new Map<string, bigint>();
  const transferMetadata = new Map<string, TokenMetadata>();
  const warnings: string[] = [];
  for (const transfer of transfers) {
    const tokenAddress = normalizeAddress(transfer.tokenAddress);
    const amount = BigInt(transfer.amountBaseUnits);
    balances.set(tokenAddress, (balances.get(tokenAddress) ?? 0n) +
      (normalizeAddress(transfer.to) === normalizedAddress ? amount : -amount));
    if (options.metadata) {
      const metadata = options.metadata instanceof Map
        ? options.metadata.get(tokenAddress)
        : await options.metadata.get(tokenAddress);
      if (metadata) transferMetadata.set(tokenAddress, metadata);
    }
  }
  const tokenHoldings: TokenHolding[] = [...balances.entries()].map(([tokenAddress, balanceBaseUnits]): TokenHolding => {
    const metadata = transferMetadata.get(tokenAddress);
    if (!metadata || metadata.status === "unknown" || metadata.decimals === undefined) {
      warnings.push(`Unknown token metadata for ${tokenAddress}; balance remains in base units`);
      return {
        tokenAddress,
        balanceBaseUnits: balanceBaseUnits.toString(),
        ...(metadata?.symbol ? { symbol: metadata.symbol } : {}),
        metadataStatus: "unknown" as const,
      };
    }
    return {
      tokenAddress,
      ...(metadata.symbol ? { symbol: metadata.symbol } : {}),
      decimals: metadata.decimals,
      balanceBaseUnits: balanceBaseUnits.toString(),
      balance: decimalBalance(balanceBaseUnits, metadata.decimals),
      metadataStatus: "resolved" as const,
    };
  }).filter((holding) => holding.balanceBaseUnits !== "0");
  if (transfers.some((transfer) => transfer.decimals === 0)) {
    warnings.push("Some transfer records have unknown decimals; holdings may only be reliable in base units");
  }
  const confidence: WalletProfile["confidence"] = warnings.length > 0 ? "low" : "medium";
  return {
    address: normalizedAddress,
    ...(timestamps.length ? { firstSeen: Math.min(...timestamps), lastSeen: Math.max(...timestamps) } : {}),
    transactionCount: Math.max(transactions.length, options.discoveryMetrics?.transactionCount ?? 0),
    transferCount: Math.max(transfers.length, options.discoveryMetrics?.transferCount ?? 0),
    activeBlocks: Math.max(activeBlocks, options.discoveryMetrics?.activeBlocks ?? 0),
    activeDays,
    ...(options.nativeBalanceWei === undefined ? {} : { nativeBalanceWei: options.nativeBalanceWei }),
    tokenHoldings,
    warnings,
    confidence,
  };
}
