import { describe, expect, it } from "vitest";
import { discoverActiveWallets, type DiscoveryProvider } from "../src/ingestion/discovery.js";
import { ERC20_TRANSFER_TOPIC } from "../src/ingestion/rpc.js";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const topic = (value: string) => `0x${value.slice(2).padStart(64, "0")}`;

describe("discoverActiveWallets", () => {
  it("filters contracts, deduplicates participants, scores, and caps results", async () => {
    const walletA = address(10);
    const walletB = address(11);
    const contract = address(12);
    const provider: DiscoveryProvider = {
      getBlockNumber: async () => 5,
      getBlock: async (number) => number === 4 ? {
        number: "0x4",
        timestamp: "0x64",
        transactions: [
          { hash: "a", from: walletA, to: contract, value: "0x1" },
          { hash: "b", from: walletA, to: walletB, value: "0x1" },
        ],
      } : null,
      getLogs: async () => [{
        address: address(99),
        topics: [ERC20_TRANSFER_TOPIC, topic(walletB), topic(walletA)],
        data: "0x1",
        transactionHash: "t",
        blockNumber: "0x4",
      }],
      isContractAddress: async (candidate) => candidate === contract,
    };
    const result = await discoverActiveWallets(provider, { window: 2, limit: 2, minScore: 1 });
    expect(result).toHaveLength(2);
    expect(result.map((candidate) => candidate.address)).toEqual([walletA, walletB]);
    expect(result[0]).toMatchObject({ transactionCount: 2, transferCount: 1, activeBlocks: 1, score: 5 });
    expect(result.some((candidate) => candidate.address === contract)).toBe(false);
  });

  it("applies the minimum score and explicit exclusions", async () => {
    const candidate = address(20);
    const provider: DiscoveryProvider = {
      getBlockNumber: async () => 1,
      getBlock: async () => ({
        number: "0x1", timestamp: "0x1",
        transactions: [{ hash: "a", from: candidate, to: null, value: "0x0" }],
      }),
      getLogs: async () => [],
      isContractAddress: async () => false,
    };
    expect(await discoverActiveWallets(provider, {
      window: 1, minScore: 3, excludedAddresses: [candidate],
    })).toEqual([]);
  });
});
