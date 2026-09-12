import { describe, expect, it } from "vitest";
import { calculateFifoPnl } from "../src/pnl.js";

describe("calculateFifoPnl", () => {
  it("matches sells against the oldest lots and includes fees in basis", () => {
    const result = calculateFifoPnl([
      { asset: "ETH", assetType: "native", side: "buy", quantity: 1, unitPriceUsd: 1000, feeUsd: 10, timestamp: 1, transactionHash: "buy-1" },
      { asset: "ETH", assetType: "native", side: "buy", quantity: 1, unitPriceUsd: 1500, timestamp: 2, transactionHash: "buy-2" },
      { asset: "ETH", assetType: "native", side: "sell", quantity: 1.5, unitPriceUsd: 2000, feeUsd: 20, timestamp: 3, transactionHash: "sell-1" },
    ]);

    expect(result.costBasisUsd).toBeCloseTo(1760);
    expect(result.proceedsUsd).toBeCloseTo(2980);
    expect(result.realizedPnlUsd).toBeCloseTo(1220);
    expect(result.openPositions).toEqual([{ asset: "ETH", quantity: 0.5, costBasisUsd: 750 }]);
  });

  it("reports unmatched sells instead of inventing acquisition history", () => {
    const result = calculateFifoPnl([
      { asset: "USDC", assetType: "token", side: "sell", quantity: 5, unitPriceUsd: 1, timestamp: 1, transactionHash: "sell-only" },
    ]);

    expect(result.realizedPnlUsd).toBe(0);
    expect(result.proceedsUsd).toBe(0);
    expect(result.warnings[0]).toContain("without a matched FIFO lot");
  });

  it("ignores invalid events with a warning", () => {
    const result = calculateFifoPnl([
      { asset: "ETH", assetType: "native", side: "buy", quantity: 0, unitPriceUsd: 1000, timestamp: 1, transactionHash: "bad" },
    ]);

    expect(result.openPositions).toHaveLength(0);
    expect(result.warnings).toEqual(["Ignored invalid trade bad"]);
  });
});
