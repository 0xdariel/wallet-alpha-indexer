import type { HistoricalPriceProvider, HistoricalPriceRequest } from "./swaps.js";
import type { RpcDataProvider } from "./ingestion/rpc.js";

export interface LiquidityPair {
  poolAddress: string;
  tokenAddress: string;
  quoteTokenAddress: string;
  quoteUsd: number;
}

const SELECTOR = {
  getReserves: "0x0902f1ac",
  token0: "0x0dfe1681",
};

function address(value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid token or pool address: ${value}`);
  return value.toLowerCase();
}

function word(value: string, offset: number): bigint {
  return BigInt(`0x${value.slice(2 + offset * 64, 2 + (offset + 1) * 64)}`);
}

function decodeAddress(value: string): string {
  return `0x${value.slice(-40)}`.toLowerCase();
}

function toNumber(value: bigint, decimals: number): number {
  const result = Number(value) / (10 ** decimals);
  if (!Number.isFinite(result)) throw new Error("Reserve value exceeds safe numeric range");
  return result;
}

export class OnChainLiquidityPriceProvider implements HistoricalPriceProvider {
  private readonly pairs: readonly LiquidityPair[];
  private readonly provider: RpcDataProvider;
  private readonly decimals: ReadonlyMap<string, number>;

  constructor(provider: RpcDataProvider, pairs: readonly LiquidityPair[], decimals: ReadonlyMap<string, number>) {
    if (!provider.call) throw new Error("RPC provider must support eth_call for on-chain pricing");
    this.provider = provider;
    this.pairs = pairs.map((pair) => ({
      ...pair,
      poolAddress: address(pair.poolAddress),
      tokenAddress: address(pair.tokenAddress),
      quoteTokenAddress: address(pair.quoteTokenAddress),
    }));
    this.decimals = decimals;
    for (const pair of this.pairs) {
      if (!Number.isFinite(pair.quoteUsd) || pair.quoteUsd < 0) throw new Error("Pair quoteUsd must be non-negative");
    }
  }

  async getUsdPrice(request: HistoricalPriceRequest): Promise<number | undefined> {
    const token = address(request.assetAddress);
    const pair = this.pairs.find((candidate) => candidate.tokenAddress === token);
    if (!pair || request.blockNumber === undefined) return undefined;
    const tokenDecimals = this.decimals.get(pair.tokenAddress);
    const quoteDecimals = this.decimals.get(pair.quoteTokenAddress);
    if (tokenDecimals === undefined || quoteDecimals === undefined) return undefined;
    const call = this.provider.call;
    if (!call) return undefined;
    const [token0Raw, reservesRaw] = await Promise.all([
      call(pair.poolAddress, SELECTOR.token0, request.blockNumber),
      call(pair.poolAddress, SELECTOR.getReserves, request.blockNumber),
    ]);
    const token0 = decodeAddress(token0Raw);
    const reserve0 = word(reservesRaw, 0);
    const reserve1 = word(reservesRaw, 1);
    const tokenReserve = token0 === pair.tokenAddress ? reserve0 : reserve1;
    const quoteReserve = token0 === pair.tokenAddress ? reserve1 : reserve0;
    if (tokenReserve <= 0n || quoteReserve <= 0n) return undefined;
    return (toNumber(quoteReserve, quoteDecimals) / toNumber(tokenReserve, tokenDecimals)) * pair.quoteUsd;
  }
}
