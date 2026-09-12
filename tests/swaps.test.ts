import { describe, expect, it } from "vitest";
import {
  UNISWAP_V2_SWAP_TOPIC,
  UniswapV2SwapAdapter,
  decodeDexSwapLogs,
  priceDecodedSwaps,
  type EvmEventLog,
} from "../src/swaps.js";

const wallet = "0x0000000000000000000000000000000000000001";
const pool = "0x0000000000000000000000000000000000000002";
const token0 = "0x0000000000000000000000000000000000000003";
const token1 = "0x0000000000000000000000000000000000000004";
const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
const word = (value: bigint) => value.toString(16).padStart(64, "0");

function swapLog(data: string, topic0 = UNISWAP_V2_SWAP_TOPIC): EvmEventLog {
  return {
    address: pool,
    topics: [topic0, topic(wallet), topic(wallet)],
    data,
    transactionHash: "0xswap",
    chain: "robinhood",
    timestamp: 1_700_000_000,
    blockNumber: 10,
  };
}

describe("provider-neutral DEX swap decoding", () => {
  const adapter = new UniswapV2SwapAdapter({
    poolAddress: pool,
    token0: { address: token0, symbol: "AAA", decimals: 2 },
    token1: { address: token1, symbol: "BBB", decimals: 3 },
  });

  it("decodes only the explicitly supported Uniswap V2 Swap signature", () => {
    const logs = [
      swapLog(`0x${word(1000n)}${word(0n)}${word(0n)}${word(2500n)}`),
      {
        ...swapLog(`0x${word(1n)}${word(0n)}${word(0n)}${word(1n)}`),
        topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", topic(wallet), topic(pool)],
      },
    ];
    expect(decodeDexSwapLogs(logs, [adapter], wallet)).toEqual([expect.objectContaining({
      protocol: "uniswap-v2",
      amountInBaseUnits: "1000",
      amountOutBaseUnits: "2500",
      assetIn: expect.objectContaining({ address: token0 }),
      assetOut: expect.objectContaining({ address: token1 }),
    })]);
  });

  it("returns missing-price warnings and never fabricates events", async () => {
    const [swap] = decodeDexSwapLogs(
      [swapLog(`0x${word(1000n)}${word(0n)}${word(0n)}${word(2500n)}`)],
      [adapter],
      wallet,
    );
    const result = await priceDecodedSwaps([swap!], {
      getUsdPrice: async ({ assetAddress }) => assetAddress === token0 ? 2 : undefined,
    });
    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual(["Missing historical USD price for swap 0xswap; swap excluded from PnL"]);
  });

  it("rejects malformed swaps with multiple input or output legs", () => {
    expect(
      decodeDexSwapLogs(
        [swapLog(`0x${word(1000n)}${word(1n)}${word(0n)}${word(2500n)}`)],
        [adapter],
        wallet,
      ),
    ).toEqual([]);
  });

  it("rejects non-finite or negative historical prices", async () => {
    const [swap] = decodeDexSwapLogs(
      [swapLog(`0x${word(1000n)}${word(0n)}${word(0n)}${word(2500n)}`)],
      [adapter],
      wallet,
    );
    const result = await priceDecodedSwaps([swap!], {
      getUsdPrice: async ({ assetAddress }) => assetAddress === token0 ? Number.NaN : -1,
    });
    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual(["Invalid historical USD price for swap 0xswap; swap excluded from PnL"]);
  });

  it("creates deterministic token trade events when both prices exist", async () => {
    const [swap] = decodeDexSwapLogs(
      [swapLog(`0x${word(1000n)}${word(0n)}${word(0n)}${word(2500n)}`)],
      [adapter],
      wallet,
    );
    const result = await priceDecodedSwaps([swap!], { getUsdPrice: async () => 2 });
    expect(result.warnings).toEqual([]);
    expect(result.events).toEqual([
      expect.objectContaining({ asset: token0, side: "sell", quantity: 10, unitPriceUsd: 2 }),
      expect.objectContaining({ asset: token1, side: "buy", quantity: 2.5, unitPriceUsd: 2 }),
    ]);
  });
});
