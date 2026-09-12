import { loadRobinhoodChainConfig } from "./config.js";
import { createHttpJsonRpcTransport } from "./ingestion/http-rpc.js";
import { createJsonRpcProvider } from "./ingestion/rpc.js";
import { HttpHistoricalPriceProvider } from "./pricing.js";

interface ValidationOptions {
  rpcUrl?: string;
  priceUrlTemplate?: string;
  assetAddress?: string;
  timestamp?: number;
  timeoutMs: number;
}

function integer(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

export function parseValidationArgs(args: string[]): ValidationOptions {
  const options: ValidationOptions = { timeoutMs: 10_000 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--rpc-url") options.rpcUrl = value;
    else if (argument === "--price-url-template") options.priceUrlTemplate = value;
    else if (argument === "--asset") options.assetAddress = value;
    else if (argument === "--timestamp") options.timestamp = integer(value, argument);
    else if (argument === "--timeout-ms") options.timeoutMs = integer(value, argument);
    else throw new Error(`Unknown option ${argument}`);
  }
  if (!options.priceUrlTemplate) throw new Error("Validation requires --price-url-template");
  if (!options.assetAddress || !/^0x[0-9a-fA-F]{40}$/.test(options.assetAddress)) {
    throw new Error("Validation requires --asset with a 20-byte EVM address");
  }
  return options;
}

export async function runValidation(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = parseValidationArgs(args);
  const config = loadRobinhoodChainConfig({ ...env, ...(options.rpcUrl ? { ROBINHOOD_CHAIN_RPC_URL: options.rpcUrl } : {}) });
  if (!config.rpcUrl) throw new Error("Set ROBINHOOD_CHAIN_RPC_URL or pass --rpc-url");
  const provider = createJsonRpcProvider(createHttpJsonRpcTransport(config.rpcUrl, { timeoutMs: options.timeoutMs }));
  const latest = await provider.getBlockNumber();
  const block = await provider.getBlock(latest);
  if (!block) throw new Error("RPC returned no latest block");
  const timestamp = options.timestamp ?? Number(BigInt(block.timestamp));
  const prices = new HttpHistoricalPriceProvider({ endpointTemplate: options.priceUrlTemplate!, timeoutMs: options.timeoutMs });
  const price = await prices.getUsdPrice({
    assetAddress: options.assetAddress!,
    chain: config.name,
    timestamp,
    blockNumber: latest,
    transactionHash: "validation",
  });
  process.stdout.write(`${JSON.stringify({ ok: true, chain: config.name, chainId: config.chainId, latestBlock: latest, timestamp, priceUsd: price }, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("validate.ts") || process.argv[1]?.endsWith("validate.js")) {
  runValidation(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Validation failed"}\n`);
    process.exitCode = 1;
  });
}
