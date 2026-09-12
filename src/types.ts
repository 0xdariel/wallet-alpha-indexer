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
