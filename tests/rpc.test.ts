import { describe, expect, it } from "vitest";
import { ERC20_TRANSFER_TOPIC, createBlockCursor, ingestRpcRange, type RpcDataProvider } from "../src/ingestion/rpc.js";

const wallet = "0x0000000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";
const token = "0x0000000000000000000000000000000000000003";
const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;

describe("incremental RPC ingestion", () => {
  it("decodes wallet boundaries and advances the cursor", async () => {
    const provider: RpcDataProvider = {
      getBlockNumber: async () => 8,
      getBlock: async (number) => number === 7 ? {
        number: "0x7", timestamp: "0x64",
        transactions: [
          { hash: "native-in", from: other, to: wallet, value: "0x2a" },
          { hash: "ignored", from: other, to: other, value: "0x1" },
        ],
      } : null,
      getLogs: async () => [{
        address: token, topics: [ERC20_TRANSFER_TOPIC, topic(other), topic(wallet)],
        data: "0x2a", transactionHash: "token-in", blockNumber: "0x7",
      }],
    };
    const result = await ingestRpcRange(wallet, "robinhood", provider, createBlockCursor(7), { toBlock: 8 });
    expect(result.cursor).toEqual({ nextBlock: 9 });
    expect(result.transactions[0]?.valueWei).toBe("42");
    expect(result.tokenTransfers).toEqual([expect.objectContaining({
      transactionHash: "token-in", from: other, to: wallet, amountBaseUnits: "42", timestamp: 100,
    })]);
  });

  it("does not advance when the cursor is already ahead", async () => {
    const provider: RpcDataProvider = {
      getBlockNumber: async () => 3,
      getBlock: async () => null,
      getLogs: async () => [],
    };
    expect(await ingestRpcRange(wallet, "robinhood", provider, createBlockCursor(4)))
      .toEqual({ transactions: [], tokenTransfers: [], cursor: { nextBlock: 4 } });
  });
});
