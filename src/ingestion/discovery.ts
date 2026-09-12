import type { RpcBlock, RpcDataProvider, RpcLog } from "./rpc.js";

export interface DiscoveryProvider extends RpcDataProvider {
  isContractAddress(address: string): Promise<boolean>;
}

export interface DiscoveryOptions {
  window?: number;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  minScore?: number;
  excludedAddresses?: string[];
}

export interface CandidateMetrics {
  address: string;
  transactionCount: number;
  transferCount: number;
  activeBlocks: number;
  score: number;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_WINDOW = 100;
const DEFAULT_LIMIT = 25;
const DEFAULT_MIN_SCORE = 2;

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || topic.length < 40) return null;
  return normalizeAddress(`0x${topic.slice(-40)}`);
}

function blockNumber(block: RpcBlock): number {
  return Number(BigInt(block.number));
}

function collectCandidate(
  metrics: Map<string, CandidateMetrics>,
  activeBlocks: Map<string, Set<number>>,
  address: string | null,
  block: number,
  kind: "transaction" | "transfer",
): void {
  if (!address || address === ZERO_ADDRESS) return;
  const current = metrics.get(address) ?? {
    address,
    transactionCount: 0,
    transferCount: 0,
    activeBlocks: 0,
    score: 0,
  };
  if (kind === "transaction") current.transactionCount += 1;
  else current.transferCount += 1;
  current.score = current.transactionCount + (current.transferCount * 2);
  metrics.set(address, current);
  const blocks = activeBlocks.get(address) ?? new Set<number>();
  blocks.add(block);
  activeBlocks.set(address, blocks);
  current.activeBlocks = blocks.size;
  current.score += current.activeBlocks;
}

export async function discoverActiveWallets(
  provider: DiscoveryProvider,
  options: DiscoveryOptions = {},
): Promise<CandidateMetrics[]> {
  const window = options.window ?? DEFAULT_WINDOW;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  if (!Number.isSafeInteger(window) || window < 1 || window > 10_000) {
    throw new Error("Discovery window must be between 1 and 10000 blocks");
  }
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Discovery limit must be positive");
  if (!Number.isFinite(minScore) || minScore < 0) throw new Error("Discovery minScore must be non-negative");

  const latest = options.toBlock ?? await provider.getBlockNumber();
  if (!Number.isSafeInteger(latest) || latest < 0) throw new Error("Discovery toBlock must be a non-negative safe integer");
  if (options.fromBlock !== undefined &&
      (!Number.isSafeInteger(options.fromBlock) || options.fromBlock < 0)) {
    throw new Error("Discovery fromBlock must be a non-negative safe integer");
  }
  const fromBlock = options.fromBlock ?? Math.max(0, latest - window + 1);
  if (fromBlock > latest) throw new Error("Discovery fromBlock cannot be greater than toBlock/latest block");
  const [blocks, logs] = await Promise.all([
    Promise.all(Array.from({ length: latest - fromBlock + 1 }, (_, i) => provider.getBlock(fromBlock + i))),
    provider.getLogs(fromBlock, latest),
  ]);
  const metrics = new Map<string, CandidateMetrics>();
  const activeBlocks = new Map<string, Set<number>>();
  const excluded = new Set([ZERO_ADDRESS, ...(options.excludedAddresses ?? []).map(normalizeAddress)]);
  const blockByHash = new Map<string, number>();
  for (const block of blocks) {
    if (!block) continue;
    blockByHash.set(block.number, blockNumber(block));
    for (const transaction of block.transactions) {
      collectCandidate(metrics, activeBlocks, normalizeAddress(transaction.from), blockNumber(block), "transaction");
      collectCandidate(metrics, activeBlocks, transaction.to ? normalizeAddress(transaction.to) : null, blockNumber(block), "transaction");
    }
  }
  for (const log of logs) {
    const block = blockByHash.get(log.blockNumber) ?? Number(BigInt(log.blockNumber));
    collectCandidate(metrics, activeBlocks, topicAddress(log.topics[1]), block, "transfer");
    collectCandidate(metrics, activeBlocks, topicAddress(log.topics[2]), block, "transfer");
  }
  const candidates = [...metrics.values()]
    .filter((candidate) => !excluded.has(candidate.address) && candidate.score >= minScore);
  const contractResults = await Promise.all(
    candidates.map(async (candidate) => [candidate, await provider.isContractAddress(candidate.address)] as const),
  );
  return contractResults
    .filter(([, isContract]) => !isContract)
    .map(([candidate]) => candidate)
    .sort((a, b) => b.score - a.score || b.transferCount - a.transferCount || a.address.localeCompare(b.address))
    .slice(0, limit);
}
