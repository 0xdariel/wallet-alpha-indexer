import type { EvmTransaction, TokenTransfer, WalletConfig } from "../types.js";

export interface EvmDataProvider {
  getTransactions(walletAddress: string): Promise<EvmTransaction[]>;
  getTokenTransfers(walletAddress: string): Promise<TokenTransfer[]>;
}

export interface ChainActivity {
  chain: string;
  transactions: EvmTransaction[];
  tokenTransfers: TokenTransfer[];
}

/**
 * Provider-neutral ingestion orchestration. Adapters can wrap an indexer API,
 * an RPC archive node, or a local fixture without changing the tracker core.
 */
export async function ingestWalletActivity(
  config: WalletConfig,
  providers: Record<string, EvmDataProvider>,
): Promise<ChainActivity[]> {
  return Promise.all(
    config.chains.map(async (chain) => {
      const provider = providers[chain];
      if (!provider) {
        throw new Error(`No EVM data provider configured for chain "${chain}"`);
      }
      const [transactions, tokenTransfers] = await Promise.all([
        provider.getTransactions(config.address),
        provider.getTokenTransfers(config.address),
      ]);
      return { chain, transactions, tokenTransfers };
    }),
  );
}
