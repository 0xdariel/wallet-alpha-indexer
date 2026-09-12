import { describe, expect, it, vi } from "vitest";
import { createHttpJsonRpcTransport } from "../src/ingestion/http-rpc.js";

describe("createHttpJsonRpcTransport", () => {
  it("sends JSON-RPC requests and returns results", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: "0x2" }), { status: 200 }));
    const transport = createHttpJsonRpcTransport("https://rpc.example.test", { fetchImpl });
    await expect(transport.request("eth_blockNumber", [])).resolves.toBe("0x2");
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: "POST" }));
  });

  it("reports provider errors and timeouts clearly", async () => {
    const errorFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: -32000, message: "denied" },
    }), { status: 200 }));
    await expect(createHttpJsonRpcTransport("https://rpc.example.test", { fetchImpl: errorFetch })
      .request("eth_getCode", [])).rejects.toThrow("denied");
    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    await expect(createHttpJsonRpcTransport("https://rpc.example.test", { fetchImpl: timeoutFetch, timeoutMs: 1 })
      .request("eth_blockNumber", [])).rejects.toThrow("timed out");
  });
});
