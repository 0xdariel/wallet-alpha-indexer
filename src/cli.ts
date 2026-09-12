import { loadRobinhoodChainConfig } from "./config.js";
import { discoverActiveWallets } from "./ingestion/discovery.js";
import { createHttpJsonRpcTransport } from "./ingestion/http-rpc.js";
import { loadDiscoverySnapshot, saveDiscoverySnapshot } from "./ingestion/persistence.js";
import { createJsonRpcProvider } from "./ingestion/rpc.js";

interface CliOptions {
  rpcUrl?: string;
  fromBlock?: number;
  toBlock?: number;
  window?: number;
  limit?: number;
  minScore?: number;
  statePath: string;
  timeoutMs: number;
}

function parseNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

export function parseDiscoveryArgs(args: string[]): CliOptions {
  const options: CliOptions = { statePath: ".robinhood-discovery.json", timeoutMs: 10_000 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--rpc-url") options.rpcUrl = value;
    else if (argument === "--from-block") options.fromBlock = parseNumber(value, argument);
    else if (argument === "--to-block") options.toBlock = parseNumber(value, argument);
    else if (argument === "--window") options.window = parseNumber(value, argument);
    else if (argument === "--limit") options.limit = parseNumber(value, argument);
    else if (argument === "--min-score") options.minScore = Number(value);
    else if (argument === "--state") options.statePath = value;
    else if (argument === "--timeout-ms") options.timeoutMs = parseNumber(value, argument);
    else throw new Error(`Unknown option ${argument}`);
  }
  return options;
}

export async function runDiscovery(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = parseDiscoveryArgs(args);
  const config = loadRobinhoodChainConfig({ ...env, ...(options.rpcUrl ? { ROBINHOOD_CHAIN_RPC_URL: options.rpcUrl } : {}) });
  if (!config.rpcUrl) throw new Error("Set ROBINHOOD_CHAIN_RPC_URL or pass --rpc-url");
  const provider = createJsonRpcProvider(createHttpJsonRpcTransport(config.rpcUrl, { timeoutMs: options.timeoutMs }));
  const latest = options.toBlock ?? await provider.getBlockNumber();
  const saved = options.fromBlock === undefined ? await loadDiscoverySnapshot(options.statePath) : null;
  const fromBlock = options.fromBlock ?? saved?.cursor.nextBlock ?? Math.max(0, latest - (options.window ?? 100) + 1);
  if (fromBlock > latest) throw new Error("fromBlock cannot be greater than toBlock/latest block");
  const discoveryOptions = {
    window: latest - fromBlock + 1,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.minScore === undefined ? {} : { minScore: options.minScore }),
  };
  const candidates = await discoverActiveWallets(provider, discoveryOptions);
  await saveDiscoverySnapshot(options.statePath, {
    cursor: { nextBlock: latest + 1 },
    candidates,
    savedAt: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify({ chain: config.name, chainId: config.chainId, fromBlock, toBlock: latest, candidates }, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  runDiscovery(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Discovery failed"}\n`);
    process.exitCode = 1;
  });
}
