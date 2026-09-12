import type { JsonRpcTransport } from "./rpc.js";

export interface HttpJsonRpcTransportOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleepImpl?: (milliseconds: number) => Promise<void>;
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
  const maxRetries = options.maxRetries ?? 3;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 5_000;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error("RPC maxRetries must be a non-negative integer");
  if (!Number.isFinite(retryBaseDelayMs) || retryBaseDelayMs < 0) throw new Error("RPC retryBaseDelayMs must be non-negative");
  if (!Number.isFinite(retryMaxDelayMs) || retryMaxDelayMs < retryBaseDelayMs) {
    throw new Error("RPC retryMaxDelayMs must be at least retryBaseDelayMs");
  }
  const sleepImpl = options.sleepImpl ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let requestId = 0;
  return {
    async request<T>(method: string, params: unknown[]) {
      for (let attempt = 0; ; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            if (!retryable || attempt >= maxRetries) {
              throw new Error(`RPC HTTP request failed for ${method} with status ${response.status}${response.statusText ? ` (${response.statusText})` : ""}`);
            }
            const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
            const exponential = Math.min(retryMaxDelayMs, retryBaseDelayMs * (2 ** attempt));
            await sleepImpl(Math.min(retryMaxDelayMs, retryAfter ?? exponential));
            continue;
          }
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
      }
    },
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
