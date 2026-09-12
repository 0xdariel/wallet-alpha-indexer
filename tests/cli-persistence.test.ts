import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDiscoveryArgs } from "../src/cli.js";
import { loadDiscoverySnapshot, saveDiscoverySnapshot } from "../src/ingestion/persistence.js";

describe("discovery CLI configuration and persistence", () => {
  it("parses explicit range and scoring options without exposing URLs", () => {
    expect(parseDiscoveryArgs([
      "--rpc-url", "https://secret.example/rpc",
      "--from-block", "10", "--to-block", "20", "--limit", "5", "--min-score", "3",
    ])).toMatchObject({ rpcUrl: "https://secret.example/rpc", fromBlock: 10, toBlock: 20, limit: 5, minScore: 3 });
  });

  it("round-trips a durable snapshot and returns null when absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wallet-alpha-"));
    const path = join(directory, "state.json");
    const snapshot = {
      cursor: { nextBlock: 21 },
      candidates: [{ address: "0x0000000000000000000000000000000000000001", transactionCount: 1, transferCount: 0, activeBlocks: 1, score: 2 }],
      savedAt: "2026-01-01T00:00:00.000Z",
    };
    try {
      expect(await loadDiscoverySnapshot(path)).toBeNull();
      await saveDiscoverySnapshot(path, snapshot);
      expect(await loadDiscoverySnapshot(path)).toEqual(snapshot);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
