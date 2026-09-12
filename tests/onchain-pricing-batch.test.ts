import { describe, expect, it } from "vitest";
import { OnChainLiquidityPriceProvider } from "../src/onchain-pricing.js";
import { buildBatchReports } from "../src/batch.js";

const token = "0x0000000000000000000000000000000000000001";
const quote = "0x0000000000000000000000000000000000000002";
const pool = "0x0000000000000000000000000000000000000003";
const wallet = "0x0000000000000000000000000000000000000004";
const pad = (value: string) => `0x${value.padStart(64, "0")}`;

describe("on-chain pricing", () => {
  it("calculates a block-scoped price from configured reserves", async () => {
    const provider = new OnChainLiquidityPriceProvider({
      getBlockNumber: async () => 1,
      getBlock: async () => null,
      getLogs: async () => [],
      call: async (_to, data) => data === "0x0dfe1681"
        ? pad(token.slice(2))
        : `0x${(1000n * 10n ** 18n).toString(16).padStart(64, "0")}${(2000n * 10n ** 6n).toString(16).padStart(64, "0")}${"0".repeat(128)}`,
    }, [{ poolAddress: pool, tokenAddress: token, quoteTokenAddress: quote, quoteUsd: 1 }], new Map([[token, 18], [quote, 6]]));
    await expect(provider.getUsdPrice({ assetAddress: token, chain: "robinhood", timestamp: 1, blockNumber: 10, transactionHash: "0x1" })).resolves.toBe(2);
    await expect(provider.getUsdPrice({ assetAddress: "0x0000000000000000000000000000000000000005", chain: "robinhood", timestamp: 1, blockNumber: 10, transactionHash: "0x1" })).resolves.toBeUndefined();
  });
});

describe("batch reports", () => {
  it("filters unsupported reports and ranks ties deterministically", async () => {
    const candidates = [
      { address: wallet, transactionCount: 1, transferCount: 1, activeBlocks: 1, score: 4 },
      { address: token, transactionCount: 1, transferCount: 1, activeBlocks: 1, score: 4 },
    ];
    const batch = await buildBatchReports(candidates, (candidate) => ({
      walletAddress: candidate.address, chain: "robinhood", fromBlock: 1, toBlock: 1,
      provider: { getBlockNumber: async () => 1, getBlock: async () => ({ number: "0x1", timestamp: "0x1", transactions: [] }), getLogs: async () => [] },
      adapters: [], metadata: { get: async () => ({ address: token, decimals: 18, status: "resolved" }) } as never,
      prices: { getUsdPrice: async () => undefined },
    }));
    expect(batch.results.map((result) => result.address)).toEqual([token, wallet]);
    expect(batch.included).toBe(0);
    expect(batch.results.every((result) => result.status === "unsupported")).toBe(true);
  });
});
