import type { HistoricalPriceProvider, HistoricalPriceRequest } from "./swaps.js";

export interface HttpHistoricalPriceProviderOptions {
  endpointTemplate: string;
  timeoutMs?: number;
  maxAgeSeconds?: number;
  fetchImpl?: typeof fetch;
}

interface PricePayload {
  priceUsd?: unknown;
  price?: unknown;
  timestamp?: unknown;
  blockNumber?: unknown;
  data?: { priceUsd?: unknown; price?: unknown; timestamp?: unknown; blockNumber?: unknown };
}

function finiteInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function priceValue(payload: PricePayload): number | undefined {
  const value = payload.priceUsd ?? payload.price ?? payload.data?.priceUsd ?? payload.data?.price;
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function validateEndpointTemplate(template: string): void {
  for (const field of ["chain", "assetAddress", "timestamp"]) {
    if (!template.includes(`{${field}}`)) {
      throw new Error(`Price endpoint template must contain {${field}}`);
    }
  }
}

function expandTemplate(template: string, request: HistoricalPriceRequest): URL {
  const values: Record<string, string> = {
    chain: request.chain,
    assetAddress: request.assetAddress,
    timestamp: String(request.timestamp),
    blockNumber: request.blockNumber === undefined ? "" : String(request.blockNumber),
  };
  let expanded = template;
  for (const [key, value] of Object.entries(values)) expanded = expanded.replaceAll(`{${key}}`, encodeURIComponent(value));
  try {
    return new URL(expanded);
  } catch {
    throw new Error("Price endpoint template must produce a valid URL");
  }
}

export class HttpHistoricalPriceProvider implements HistoricalPriceProvider {
  private readonly endpointTemplate: string;
  private readonly timeoutMs: number;
  private readonly maxAgeSeconds: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpHistoricalPriceProviderOptions) {
    if (!options.endpointTemplate.trim()) throw new Error("Price endpoint template is required");
    validateEndpointTemplate(options.endpointTemplate);
    this.endpointTemplate = options.endpointTemplate;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 86_400;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("Price timeout must be positive");
    if (!Number.isFinite(this.maxAgeSeconds) || this.maxAgeSeconds < 0) throw new Error("Price max age must be non-negative");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getUsdPrice(request: HistoricalPriceRequest): Promise<number | undefined> {
    const url = expandTemplate(this.endpointTemplate, request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`price endpoint returned HTTP ${response.status}`);
      const payload = await response.json() as PricePayload | null;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("price endpoint returned an invalid JSON payload");
      }
      const price = priceValue(payload);
      if (price === undefined) throw new Error("price endpoint returned an invalid USD price");
      const quoteTimestamp = finiteInteger(payload.timestamp ?? payload.data?.timestamp);
      if (quoteTimestamp !== undefined && Math.abs(quoteTimestamp - request.timestamp) > this.maxAgeSeconds) {
        throw new Error("price quote is stale for the requested timestamp");
      }
      const quoteBlock = finiteInteger(payload.blockNumber ?? payload.data?.blockNumber);
      if (request.blockNumber !== undefined && quoteBlock !== undefined && quoteBlock > request.blockNumber) {
        throw new Error("price quote is newer than the requested block");
      }
      return price;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`price request timed out after ${this.timeoutMs}ms`);
      }
      throw error instanceof Error ? error : new Error("price request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
