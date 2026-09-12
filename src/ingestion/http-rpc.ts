import type { JsonRpcTransport } from "./rpc.js";

export interface HttpJsonRpcTransportOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createHttpJsonRpcTransport(
  rpcUrl: string,
  options: HttpJsonRpcTransportOptions = {},
): JsonRpcTransport {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error("RPC URL must be a valid URL");
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("RPC timeout must be positive");
  const fetchImpl = options.fetchImpl ?? fetch;
  let requestId = 0;
  return {
    async request<T>(method: string, params: unknown[]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`RPC HTTP request failed with status ${response.status}`);
        const payload = await response.json() as {
          result?: T;
          error?: { code?: number; message?: string };
        };
        if (payload.error) {
          throw new Error(`RPC ${method} failed: ${payload.error.message ?? "unknown error"}${payload.error.code === undefined ? "" : ` (${payload.error.code})`}`);
        }
        if (!("result" in payload)) throw new Error(`RPC ${method} returned no result`);
        return payload.result as T;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`RPC request timed out after ${timeoutMs}ms`);
        }
        throw error instanceof Error ? error : new Error(`RPC ${method} failed`);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
