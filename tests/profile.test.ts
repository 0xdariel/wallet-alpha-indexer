import { describe, expect, it } from "vitest";
import { TokenMetadataCache } from "../src/metadata.js";
import { buildWalletProfile } from "../src/profile.js";

const wallet = "0x0000000000000000000000000000000000000001";
const token = "0x0000000000000000000000000000000000000002";

describe("wallet profiles and metadata", () => {
  it("aggregates activity and formats holdings with cached metadata", async () => {
    let calls = 0;
    const cache = new TokenMetadataCache({
      resolve: async () => {
        calls += 1;
        return { symbol: "TOK", decimals: 2 };
      },
    });
    const activity = [{
      chain: "robinhood",
      transactions: [{
        hash: "tx", chain: "robinhood", from: wallet, to: token, timestamp: 1_700_000_000, valueWei: "0", blockNumber: 10,
      }],
      tokenTransfers: [{
        transactionHash: "transfer", chain: "robinhood", tokenAddress: token, decimals: 0,
        from: "0x0000000000000000000000000000000000000003", to: wallet,
        amountBaseUnits: "12345", timestamp: 1_700_000_100, blockNumber: 10,
      }],
    }];
    const metadata = await cache.get(token);
    await cache.get(token);
    const profile = await buildWalletProfile(wallet, activity, { metadata: new Map([[token, metadata]]) });
    expect(calls).toBe(1);
    expect(profile).toMatchObject({
      transactionCount: 1, transferCount: 1, activeDays: 1,
      tokenHoldings: [{ tokenAddress: token, balance: "123.45", decimals: 2, metadataStatus: "resolved" }],
    });
    expect(profile.warnings).toContain("Some transfer records have unknown decimals; holdings may only be reliable in base units");
  });

  it("keeps unknown metadata explicit", async () => {
    const cache = new TokenMetadataCache({ resolve: async () => ({ symbol: "?", decimals: 999 }) });
    const profile = await buildWalletProfile(wallet, [{
      chain: "robinhood",
      transactions: [],
      tokenTransfers: [{
        transactionHash: "transfer", chain: "robinhood", tokenAddress: token, decimals: 0,
        from: wallet, to: "0x0000000000000000000000000000000000000003",
        amountBaseUnits: "10", timestamp: 1_700_000_000,
      }],
    }], { metadata: cache });
    expect(profile.tokenHoldings[0]).toMatchObject({ metadataStatus: "unknown", balanceBaseUnits: "-10" });
    expect(profile.warnings[0]).toContain("Unknown token metadata");
  });
});
