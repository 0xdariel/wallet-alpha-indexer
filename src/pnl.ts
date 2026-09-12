import type { PnlResult, TradeEvent } from "./types.js";

interface Lot {
  quantity: number;
  unitCostUsd: number;
}

/**
 * Calculates realized PnL with FIFO lots.
 *
 * This is intentionally a transparent baseline: prices and fees must already
 * be resolved to USD by an upstream adapter. It does not infer transfers,
 * staking income, airdrops, bridges, or wallet ownership.
 */
export function calculateFifoPnl(events: TradeEvent[]): PnlResult {
  const lots = new Map<string, Lot[]>();
  let realizedPnlUsd = 0;
  let costBasisUsd = 0;
  let proceedsUsd = 0;
  const warnings: string[] = [];

  const orderedEvents = [...events].sort(
    (left, right) => left.timestamp - right.timestamp || left.transactionHash.localeCompare(right.transactionHash),
  );

  for (const event of orderedEvents) {
    if (!Number.isFinite(event.quantity) || event.quantity <= 0 || !Number.isFinite(event.unitPriceUsd)) {
      warnings.push(`Ignored invalid trade ${event.transactionHash}`);
      continue;
    }
    const feeUsd = event.feeUsd ?? 0;
    if (!Number.isFinite(feeUsd) || feeUsd < 0) {
      warnings.push(`Ignored trade with invalid fee ${event.transactionHash}`);
      continue;
    }

    const assetLots = lots.get(event.asset) ?? [];
    if (event.side === "buy") {
      assetLots.push({
        quantity: event.quantity,
        unitCostUsd: (event.quantity * event.unitPriceUsd + feeUsd) / event.quantity,
      });
      lots.set(event.asset, assetLots);
      continue;
    }

    let remaining = event.quantity;
    let matchedCost = 0;
    while (remaining > 0 && assetLots.length > 0) {
      const lot = assetLots[0];
      if (!lot) break;
      const matchedQuantity = Math.min(remaining, lot.quantity);
      matchedCost += matchedQuantity * lot.unitCostUsd;
      lot.quantity -= matchedQuantity;
      remaining -= matchedQuantity;
      if (lot.quantity === 0) assetLots.shift();
    }
    if (remaining > 0) {
      warnings.push(
        `Sell ${event.transactionHash} has ${remaining} ${event.asset} without a matched FIFO lot; realized PnL is partial`,
      );
    }
    costBasisUsd += matchedCost;
    const matchedProceeds = (event.quantity - remaining) * event.unitPriceUsd - feeUsd;
    proceedsUsd += matchedProceeds;
    realizedPnlUsd += matchedProceeds - matchedCost;
  }

  return {
    realizedPnlUsd,
    costBasisUsd,
    proceedsUsd,
    openPositions: [...lots.entries()]
      .map(([asset, assetLots]) => ({
        asset,
        quantity: assetLots.reduce((total, lot) => total + lot.quantity, 0),
        costBasisUsd: assetLots.reduce((total, lot) => total + lot.quantity * lot.unitCostUsd, 0),
      }))
      .filter((position) => position.quantity > 0),
    warnings,
  };
}
