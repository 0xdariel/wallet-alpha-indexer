import type { TokenMetadata } from "./types.js";

export interface TokenMetadataResolver {
  resolve(tokenAddress: string): Promise<Partial<Omit<TokenMetadata, "address" | "status">>>;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function validDecimals(decimals: number | undefined): decimals is number {
  return decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255;
}

export class TokenMetadataCache {
  private readonly cache = new Map<string, Promise<TokenMetadata>>();

  constructor(private readonly resolver: TokenMetadataResolver) {}

  get(tokenAddress: string): Promise<TokenMetadata> {
    const address = normalizeAddress(tokenAddress);
    const cached = this.cache.get(address);
    if (cached) return cached;
    const pending = this.resolve(address);
    this.cache.set(address, pending);
    return pending;
  }

  clear(): void {
    this.cache.clear();
  }

  private async resolve(address: string): Promise<TokenMetadata> {
    const result = await this.resolver.resolve(address);
    const decimals = validDecimals(result.decimals) ? result.decimals : undefined;
    return {
      address,
      ...(result.symbol ? { symbol: result.symbol } : {}),
      ...(result.name ? { name: result.name } : {}),
      ...(decimals === undefined ? {} : { decimals }),
      status: decimals === undefined ? "unknown" : "resolved",
    };
  }
}
