# Wallet Alpha Indexer

This repository contains a small, provider-neutral MVP for tracking the performance of a **publicly supplied EVM wallet address**. It is not a custody, trading, identity, or Robinhood attribution product.

## Setup

```bash
npm install
npm test
npm run build
```

Configure a wallet and optional provider endpoints with environment variables:

```bash
WALLET_ADDRESS=0x0000000000000000000000000000000000000001
WALLET_CHAINS=ethereum,base
EVM_PROVIDER_URL_ETHEREUM=https://your-indexer-or-rpc.example/ethereum
EVM_PROVIDER_URL_BASE=https://your-indexer-or-rpc.example/base
```

`loadWalletConfig` validates the public address and maps chain names to provider URLs. `ingestWalletActivity` accepts an `EvmDataProvider` per chain, so an indexer API, archive-node adapter, or test fixture can be used without changing the core. This repository deliberately does not ship a provider client or require API secrets.

## PnL baseline

`calculateFifoPnl` calculates realized USD PnL using first-in-first-out lots. Buy fees increase cost basis; sell fees reduce proceeds. Events must already contain normalized quantities and USD prices, which is the responsibility of the upstream adapter. Sells without matching lots are reported as partial and produce warnings rather than inventing acquisition history.

This is an explicitly incomplete baseline. It does not yet value open positions, resolve historical prices, or attribute transfers, staking, airdrops, bridges, wrapped assets, tax lots, or cross-wallet activity. On-chain data can be incomplete or reorged, token metadata can be misleading, and a public address does not prove ownership or identify a person or platform. In particular, no result should be presented as evidence that a wallet belongs to Robinhood or any other service.
