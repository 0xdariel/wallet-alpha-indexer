import { loadRobinhoodChainConfig } from "./config.js";
import { discoverActiveWallets } from "./ingestion/discovery.js";
import { createHttpJsonRpcTransport } from "./ingestion/http-rpc.js";
import { createJsonRpcProvider } from "./ingestion/rpc.js";

interface SmokeOptions {
  rpcUrl: string;
  window: number;
  timeoutMs: number;
}

export function parseSmokeArgs(args: string[]): SmokeOptions {
  let rpcUrl: string | undefined;
  let window = 10;
  let timeoutMs = 10_000;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--rpc-url") rpcUrl = value;
    else if (argument === "--window") window = Number(value);
    else if (argument === "--timeout-ms") timeoutMs = Number(value);
    else throw new Error(`Unknown option ${argument}`);
  }
  if (!rpcUrl) throw new Error("Smoke test requires an explicit --rpc-url; it is never read from state");
  if (!Number.isSafeInteger(window) || window < 1 || window > 20) {
    throw new Error("Smoke-test window must be between 1 and 20 blocks");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("Smoke-test timeout must be between 100 and 10000 milliseconds");
  }
  return { rpcUrl, window, timeoutMs };
}

export async function runSmokeTest(args: string[]): Promise<void> {
  const options = parseSmokeArgs(args);
  const config = loadRobinhoodChainConfig({ ROBINHOOD_CHAIN_RPC_URL: options.rpcUrl });
  const provider = createJsonRpcProvider(createHttpJsonRpcTransport(config.rpcUrl!, { timeoutMs: options.timeoutMs }));
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - options.window + 1);
  const candidates = await discoverActiveWallets(provider, { fromBlock, toBlock: latest, limit: 5, minScore: 1 });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    chain: config.name,
    chainId: config.chainId,
    fromBlock,
    toBlock: latest,
    candidateCount: candidates.length,
    candidates,
  }, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("smoke.ts") || process.argv[1]?.endsWith("smoke.js")) {
  runSmokeTest(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Smoke test failed"}\n`);
    process.exitCode = 1;
  });
}
