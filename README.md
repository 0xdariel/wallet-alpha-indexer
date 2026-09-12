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
ROBINHOOD_CHAIN_RPC_URL=https://your-indexer-or-rpc.example/robinhood
```

`loadWalletConfig` validates the public address and maps chain names to provider URLs. `ingestWalletActivity` accepts an `EvmDataProvider` per chain, so an indexer API, archive-node adapter, or test fixture can be used without changing the core. This repository deliberately does not ship a provider client or require API secrets.

Robinhood Chain mainnet is available as the `robinhood` chain (chain ID `4663`). `loadRobinhoodChainConfig` reads its RPC URL from `ROBINHOOD_CHAIN_RPC_URL` (or `EVM_PROVIDER_URL_ROBINHOOD`) and never embeds credentials or endpoints. `createJsonRpcProvider` adapts any JSON-RPC transport, and `ingestRpcRange` processes wallet transactions and ERC-20 `Transfer` logs from an incremental block cursor. The RPC layer is intentionally provider-neutral; applications supply the transport and may persist `BlockCursor` between runs.

`discoverActiveWallets` scans a bounded recent block window (default 100 blocks), collects transaction and ERC-20 transfer participants, checks each candidate with `eth_getCode`, deduplicates addresses, and returns a ranked list. Configure `window`, `limit`, `minScore`, and explicit excluded addresses. The conservative score is `transactionCount + 2 * transferCount + activeBlocks`; it is an activity signal only, not a profitability or ownership inference. The scanner requires no credentials beyond whatever public RPC transport the application supplies.

For an end-to-end local scan, set `ROBINHOOD_CHAIN_RPC_URL` and run:

```bash
npm run discover:robinhood -- --window 100 --limit 10 --min-score 2 --state .robinhood-discovery.json
npm run discover:robinhood -- --from-block 1000 --to-block 1100 --limit 10
```

The CLI uses a dependency-free HTTP JSON-RPC transport with a 10-second timeout, prints only structured candidate results, and persists the last scanned cursor and results as an atomic JSON snapshot. Override the endpoint with `--rpc-url`; use a local state path with `--state`. RPC URLs are not printed or persisted. Discovery is bounded to 10,000 blocks per scan and should be treated as incomplete when providers prune history or return partial logs.

For a non-persisting live validation, provide the RPC URL explicitly and use a small bounded window:

```bash
npm run smoke:robinhood -- --rpc-url https://your-rpc.example --window 10 --timeout-ms 5000
```

The smoke test accepts at most 20 blocks and a 10-second timeout, prints only chain/range/result data, and never logs or persists the RPC URL. It validates tip access, block/log discovery, contract filtering, and candidate output. A provider URL is intentionally never hardcoded.

## Wallet profiles and metadata

`buildWalletProfile` aggregates public activity into first/last seen timestamps, transaction and transfer counts, active days, optional native balance, and token holdings. Holdings are calculated from observed ERC-20 transfers only; metadata is resolved through the provider-neutral `TokenMetadataCache`, cached by token address, and marked `unknown` when decimals cannot be validated. Unknown-decimal balances remain in base units and lower profile confidence. No profile implies ownership or Robinhood-account attribution.

## PnL baseline

`calculateFifoPnl` calculates realized USD PnL using first-in-first-out lots. Buy fees increase cost basis; sell fees reduce proceeds. Events must already contain normalized quantities and USD prices, which is the responsibility of the upstream adapter. Sells without matching lots are reported as partial and produce warnings rather than inventing acquisition history.

`calculateWalletPnlBaseline` adds an explicit warning when generic transfers are present: transfers are not inferred to be swaps, and no profitability claim is made without trusted trade events and prices. This baseline reports realized PnL only and remains incomplete for open-position valuation, missing history, and unsupported activity.

This is an explicitly incomplete baseline. It does not yet value open positions, resolve historical prices, or attribute transfers, staking, airdrops, bridges, wrapped assets, tax lots, or cross-wallet activity. On-chain data can be incomplete or reorged, token metadata can be misleading, and a public address does not prove ownership or identify a person or platform. In particular, no result should be presented as evidence that a wallet belongs to Robinhood or any other service.

Robinhood ingestion supports public wallet analysis only. It does not establish ownership or attribute an address to a Robinhood account. Incomplete RPC/indexer data, reorgs, missing token metadata, and unsupported activity can materially affect PnL.
