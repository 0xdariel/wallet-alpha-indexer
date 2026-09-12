# Wallet Alpha Indexer

This repository contains a small, provider-neutral MVP for tracking the performance of a **publicly supplied EVM wallet address**. It is not a custody, trading, identity, or Robinhood attribution product.

## Setup

```bash
npm ci
npm test
npm run build
```

Tests run in Node without CSS processing. The explicit Vitest configuration keeps
Vite from discovering a host-level PostCSS configuration; this repository has no
CSS assets or PostCSS dependency.

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

## DEX swap decoding and historical pricing

The swap layer is provider-neutral and deliberately conservative. The only built-in adapter is `UniswapV2SwapAdapter`, which accepts only the canonical `Swap(address,uint256,uint256,uint256,uint256,address)` event (`0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822`) for a configured pool and token pair. ERC-20 `Transfer` logs, unknown signatures, and swaps where the wallet is not an indexed sender or recipient are ignored; no other protocol is claimed to be supported.

`HistoricalPriceProvider` supplies timestamped USD prices for both swap assets. `priceDecodedSwaps` emits token `TradeEvent`s only when both prices and validated token decimals are available, and returns an explicit warning otherwise. `HttpHistoricalPriceProvider` is a provider-neutral adapter for a configured JSON endpoint template. The template must contain `{chain}`, `{assetAddress}`, and `{timestamp}` (and may contain `{blockNumber}`); the response must contain `priceUsd` or `price`, optionally with a quote `timestamp` and `blockNumber`. Quotes older than the configured tolerance or newer than the requested block are rejected. HTTP failures, timeouts, invalid prices, and stale quotes are surfaced as warnings; URLs and endpoint contents are never logged. There is no hardcoded market-data endpoint because endpoint history, chain identifiers, and authentication contracts vary; callers must configure and test their own endpoint.

Robinhood ingestion supports public wallet analysis only. It does not establish ownership or attribute an address to a Robinhood account. Incomplete RPC/indexer data, reorgs, missing token metadata, and unsupported activity can materially affect PnL.

For bounded live validation without persisting secrets or state, configure an RPC URL (environment or flag), a price endpoint template, and one token address:

```bash
ROBINHOOD_CHAIN_RPC_URL=https://your-rpc.example npm run validate:robinhood -- \
  --price-url-template "https://your-prices.example/history?chain={chain}&asset={assetAddress}&timestamp={timestamp}&block={blockNumber}" \
  --asset 0x0000000000000000000000000000000000000001 --timeout-ms 5000
```

The command reads the latest RPC block and requests one historical quote at that block timestamp. It is bounded to one RPC block and one price request, prints only chain/range/result data, and never persists or prints either endpoint. It requires the configured price provider to support the documented template/response contract; a provider-specific API key should be supplied through that provider's normal environment or authenticated fetch integration, not committed to this repository. No live validation is run in CI without configured public endpoints.

## End-to-end Robinhood Chain PnL report

`buildWalletPnlReport` provides a bounded, provider-neutral report for a public wallet on Robinhood Chain. Supply a wallet, `fromBlock`/`toBlock` range (at most 10,000 blocks), an RPC provider, explicitly configured supported swap adapters, a `TokenMetadataCache`, and an injectable `HistoricalPriceProvider`. The pipeline:

1. Reads block timestamps and supported swap logs.
2. Resolves token decimals and symbols through the metadata cache.
3. Requests historical USD prices without fabricating missing values.
4. Converts priced swaps into FIFO events and returns deterministic JSON through `serializeWalletPnlReport`.

The report includes realized PnL, FIFO holdings, trade count, and a win rate only when at least one swap has both prices. It reports confidence and sorted warnings for missing prices, metadata, unmatched history, unsupported activity, and partial RPC data. Generic ERC-20 transfers are never treated as trades. Unrealized PnL is intentionally not calculated: holdings are open FIFO positions and are not valued at a current or historical mark. The result is an analysis of public on-chain activity only and does not prove wallet ownership or Robinhood account attribution.

## Auditable on-chain prices and batch reports

`OnChainLiquidityPriceProvider` is the built-in provider-neutral on-chain resolver. Configure
each supported liquidity pair explicitly with its pool, token, quote token, and quote USD
value, and provide validated token decimals. It reads `token0()` and `getReserves()` with
the swap's block tag, then derives a spot price from those reserves. It returns no price when
the pair, block number, decimals, or reserves are unavailable; it never selects an unknown
DEX contract, fabricates a quote, or uses a later block. Only configured Uniswap-V2-style
contracts are supported.

`buildBatchReports(candidates, createRequest, { topN, concurrency })` selects and filters a
deterministic top-N candidate set, runs bounded concurrent reports, excludes unsupported or
invalid reports from `included`, and ranks results by realized PnL, discovery score, and
address. Each result retains explicit status and warnings. Example:

```ts
const prices = new OnChainLiquidityPriceProvider(rpc, [
  { poolAddress, tokenAddress, quoteTokenAddress: usdc, quoteUsd: 1 },
], new Map([[tokenAddress, 18], [usdc, 6]]));
const batch = await buildBatchReports(candidates, (candidate) => ({
  walletAddress: candidate.address, chain: "robinhood", fromBlock, toBlock,
  provider: rpc, adapters, metadata, prices,
}), { topN: 10, concurrency: 2 });
console.log(JSON.stringify(batch));
```

Ranges remain capped at 10,000 blocks per wallet report. Batch processing is an analysis
of public data only: unsupported DEXes, missing metadata, missing reserves, pruned RPC
history, and reorgs produce warnings or invalid results rather than estimates. RPC and
price endpoint credentials are never included in reports.
