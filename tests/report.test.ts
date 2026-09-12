import { describe, expect, it } from "vitest";
import { TokenMetadataCache } from "../src/metadata.js";
import { buildWalletPnlReport, serializeWalletPnlReport } from "../src/report.js";
import { UNISWAP_V2_SWAP_TOPIC, UniswapV2SwapAdapter, type EvmEventLog } from "../src/swaps.js";
import type { RpcDataProvider } from "../src/ingestion/rpc.js";

const wallet = "0x0000000000000000000000000000000000000001";
const pool = "0x0000000000000000000000000000000000000002";
const token0 = "0x0000000000000000000000000000000000000003";
const token1 = "0x0000000000000000000000000000000000000004";
const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
const word = (value: bigint) => value.toString(16).padStart(64, "0");

function fixtureProvider(logs: EvmEventLog[]): RpcDataProvider {
  return {
    getBlockNumber: async () => 10,
    getBlock: async (number) => ({ number: `0x${number.toString(16)}`, timestamp: "0x64", transactions: [] }),
    getLogs: async (_from, _to, _address, topic0) =>
      topic0 === UNISWAP_V2_SWAP_TOPIC
        ? logs.map((log) => ({ ...log, blockNumber: "0xa" }))
        : [],
  };
}

function swapLog(hash: string): EvmEventLog {
  return {
    address: pool,
    topics: [UNISWAP_V2_SWAP_TOPIC, topic(wallet), topic(wallet)],
    data: `0x${word(1000n)}${word(0n)}${word(0n)}${word(2500n)}`,
    transactionHash: hash,
    chain: "robinhood",
    timestamp: 100,
    blockNumber: 10,
  };
}

function request(logs: EvmEventLog[], price: number | undefined) {
  return {
    walletAddress: wallet,
    chain: "robinhood",
    fromBlock: 10,
    toBlock: 10,
    provider: fixtureProvider(logs),
    adapters: [new UniswapV2SwapAdapter({
      poolAddress: pool,
      token0: { address: token0, decimals: 0 },
      token1: { address: token1, decimals: 0 },
    })],
    metadata: new TokenMetadataCache({
      resolve: async (address) => ({ symbol: address === token0 ? "AAA" : "BBB", decimals: address === token0 ? 2 : 3 }),
    }),
    prices: { getUsdPrice: async () => price },
  };
}

describe("end-to-end wallet PnL report", () => {
  it("builds a deterministic report from supported swaps", async () => {
    const report = await buildWalletPnlReport(request([swapLog("0x1")], 2));
    expect(report).toMatchObject({
      walletAddress: wallet,
      tradeCount: 1,
      winRate: 0,
      realizedPnlUsd: 0,
      holdings: [{ asset: token1, quantity: 2.5, costBasisUsd: 5 }],
      confidence: "low",
    });
    expect(serializeWalletPnlReport(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
  });

  it("excludes swaps with missing prices and says why", async () => {
    const report = await buildWalletPnlReport(request([swapLog("0xmissing")], undefined));
    expect(report.tradeCount).toBe(0);
    expect(report.winRate).toBeUndefined();
    expect(report.realizedPnlUsd).toBe(0);
    expect(report.warnings).toContain("Missing historical USD price for swap 0xmissing; swap excluded from PnL");
  });

  it("does not treat an empty range as a trade", async () => {
    const report = await buildWalletPnlReport(request([], 1));
    expect(report.tradeCount).toBe(0);
    expect(report.warnings).toContain("No supported swap events were found in the bounded range");
  });
});
