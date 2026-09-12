import type { EvmTransaction, TokenTransfer } from "../types.js";

export interface JsonRpcTransport {
  request<T>(method: string, params: unknown[]): Promise<T>;
}

export interface RpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
}

export interface RpcBlock {
  number: string;
  timestamp: string;
  transactions: RpcTransaction[];
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
}

export interface RpcDataProvider {
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<RpcBlock | null>;
  getLogs(fromBlock: number, toBlock: number, address?: string): Promise<RpcLog[]>;
}

export interface RpcDiscoveryProvider extends RpcDataProvider {
  isContractAddress(address: string): Promise<boolean>;
}

export interface BlockCursor {
  nextBlock: number;
}

export interface RpcIngestionResult {
  transactions: EvmTransaction[];
  tokenTransfers: TokenTransfer[];
  cursor: BlockCursor;
}

export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function createJsonRpcProvider(transport: JsonRpcTransport): RpcDiscoveryProvider {
  return {
    getBlockNumber: async () => hexToNumber(await transport.request<string>("eth_blockNumber", [])),
    getBlock: (blockNumber) =>
      transport.request<RpcBlock | null>("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, true]),
    getLogs: (fromBlock, toBlock, address) =>
      transport.request<RpcLog[]>("eth_getLogs", [{
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [ERC20_TRANSFER_TOPIC],
        ...(address ? { address } : {}),
      }]),
    isContractAddress: async (address) =>
      (await transport.request<string>("eth_getCode", [address, "latest"])) !== "0x",
  };
}

export function createBlockCursor(nextBlock: number): BlockCursor {
  if (!Number.isSafeInteger(nextBlock) || nextBlock < 0) {
    throw new Error("Block cursor must be a non-negative safe integer");
  }
  return { nextBlock };
}

function hexToNumber(value: string): number {
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed)) throw new Error(`RPC number exceeds safe integer range: ${value}`);
  return parsed;
}

function topicAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export async function ingestRpcRange(
  walletAddress: string,
  chain: string,
  provider: RpcDataProvider,
  cursor: BlockCursor,
  options: { toBlock?: number } = {},
): Promise<RpcIngestionResult> {
  const normalizedWallet = walletAddress.toLowerCase();
  const latest = options.toBlock ?? await provider.getBlockNumber();
  if (!Number.isSafeInteger(latest) || latest < cursor.nextBlock) {
    return { transactions: [], tokenTransfers: [], cursor: { ...cursor } };
  }
  const logs = await provider.getLogs(cursor.nextBlock, latest);
  const blocks = await Promise.all(
    Array.from({ length: latest - cursor.nextBlock + 1 }, (_, index) =>
      provider.getBlock(cursor.nextBlock + index),
    ),
  );
  const timestamps = new Map<number, number>();
  const transactions: EvmTransaction[] = [];
  for (const block of blocks) {
    if (!block) continue;
    const blockNumber = hexToNumber(block.number);
    const timestamp = hexToNumber(block.timestamp);
    timestamps.set(blockNumber, timestamp);
    for (const transaction of block.transactions) {
      if (transaction.from.toLowerCase() !== normalizedWallet &&
          transaction.to?.toLowerCase() !== normalizedWallet) continue;
      transactions.push({
        hash: transaction.hash,
        chain,
        from: transaction.from.toLowerCase(),
        to: transaction.to?.toLowerCase() ?? null,
        timestamp,
        valueWei: BigInt(transaction.value).toString(),
      });
    }
  }
  const tokenTransfers = logs
    .filter((log) => log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC && log.topics.length >= 3)
    .map((log) => {
      const fromTopic = log.topics[1];
      const toTopic = log.topics[2];
      if (!fromTopic || !toTopic) return null;
      const from = topicAddress(fromTopic);
      const to = topicAddress(toTopic);
      if (from !== normalizedWallet && to !== normalizedWallet) return null;
      const blockNumber = hexToNumber(log.blockNumber);
      return {
        transactionHash: log.transactionHash,
        chain,
        tokenAddress: log.address.toLowerCase(),
        decimals: 0,
        from,
        to,
        amountBaseUnits: BigInt(log.data).toString(),
        timestamp: timestamps.get(blockNumber) ?? 0,
      };
    })
    .filter((transfer): transfer is TokenTransfer => transfer !== null);
  return { transactions, tokenTransfers, cursor: { nextBlock: latest + 1 } };
}
