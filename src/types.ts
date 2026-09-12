export type AssetType = "native" | "token";

export interface WalletConfig {
  address: string;
  chains: string[];
  providerUrls: Record<string, string>;
}

export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl?: string;
}

export interface EvmTransaction {
  hash: string;
  chain: string;
  from: string;
  to: string | null;
  timestamp: number;
  valueWei: string;
  gasFeeWei?: string;
  blockNumber?: number;
}

export interface TokenTransfer {
  transactionHash: string;
  chain: string;
  tokenAddress: string;
  symbol?: string;
  decimals: number;
  from: string;
  to: string;
  amountBaseUnits: string;
  timestamp: number;
  blockNumber?: number;
}

export interface TradeEvent {
  asset: string;
  assetType: AssetType;
  side: "buy" | "sell";
  quantity: number;
  unitPriceUsd: number;
  feeUsd?: number;
  timestamp: number;
  transactionHash: string;
}

export interface PnlResult {
  realizedPnlUsd: number;
  costBasisUsd: number;
  proceedsUsd: number;
  openPositions: Array<{
    asset: string;
    quantity: number;
    costBasisUsd: number;
  }>;
  warnings: string[];
}

export interface TokenMetadata {
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  status: "resolved" | "unknown";
}

export interface TokenHolding {
  tokenAddress: string;
  symbol?: string;
  decimals?: number;
  balanceBaseUnits: string;
  balance?: string;
  metadataStatus: TokenMetadata["status"];
}

export interface WalletProfile {
  address: string;
  firstSeen?: number;
  lastSeen?: number;
  transactionCount: number;
  transferCount: number;
  activeBlocks: number;
  activeDays: number;
  nativeBalanceWei?: string;
  tokenHoldings: TokenHolding[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
}
