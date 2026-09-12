import { describe, expect, it, vi } from "vitest";
import { HttpHistoricalPriceProvider } from "../src/pricing.js";

const request = {
  assetAddress: "0x0000000000000000000000000000000000000001",
  chain: "robinhood",
  timestamp: 1_000,
  blockNumber: 20,
  transactionHash: "0xtrade",
};

describe("HttpHistoricalPriceProvider", () => {
  it("parses a timestamped USD quote and expands request fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      priceUsd: "1.25",
      timestamp: 1_010,
      blockNumber: 20,
    }), { status: 200 }));
    const provider = new HttpHistoricalPriceProvider({
      endpointTemplate: "https://prices.example/{chain}/{assetAddress}?at={timestamp}&block={blockNumber}",
      maxAgeSeconds: 10,
      fetchImpl,
    });
    await expect(provider.getUsdPrice(request)).resolves.toBe(1.25);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("robinhood/0x0000000000000000000000000000000000000001");
  });

  it("rejects stale, invalid, and HTTP-error responses without exposing the endpoint", async () => {
    const stale = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ price: 1, timestamp: 1_100 }), { status: 200 }));
    await expect(new HttpHistoricalPriceProvider({ endpointTemplate: "https://secret.example/{chain}/{assetAddress}/{timestamp}", maxAgeSeconds: 10, fetchImpl: stale }).getUsdPrice(request))
      .rejects.toThrow("stale");
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ priceUsd: "nope" }), { status: 200 }));
    await expect(new HttpHistoricalPriceProvider({ endpointTemplate: "https://secret.example/{chain}/{assetAddress}/{timestamp}", fetchImpl: invalid }).getUsdPrice(request))
      .rejects.toThrow("invalid USD price");
    const failure = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 }));
    await expect(new HttpHistoricalPriceProvider({ endpointTemplate: "https://secret.example/{chain}/{assetAddress}/{timestamp}", fetchImpl: failure }).getUsdPrice(request))
      .rejects.toThrow("HTTP 503");
  });

  it("requires the request identity fields in the endpoint template", () => {
    expect(() => new HttpHistoricalPriceProvider({ endpointTemplate: "https://prices.example/history" }))
      .toThrow("must contain {chain}");
  });

  it("rejects malformed JSON payloads explicitly", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response("null", { status: 200 }));
    await expect(new HttpHistoricalPriceProvider({
      endpointTemplate: "https://prices.example/{chain}/{assetAddress}/{timestamp}",
      fetchImpl: malformed,
    }).getUsdPrice(request)).rejects.toThrow("invalid JSON payload");
  });
});
