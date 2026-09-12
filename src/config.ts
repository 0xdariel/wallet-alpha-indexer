import type { ChainConfig, WalletConfig } from "./types.js";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_NAME = "robinhood";

export function loadWalletConfig(env: NodeJS.ProcessEnv = process.env): WalletConfig {
  const address = env.WALLET_ADDRESS?.trim();
  if (!address || !addressPattern.test(address)) {
    throw new Error("WALLET_ADDRESS must be a 20-byte EVM address (0x followed by 40 hex characters)");
  }

  const chains = (env.WALLET_CHAINS ?? "ethereum")
    .split(",")
    .map((chain) => chain.trim().toLowerCase())
    .filter(Boolean);
  if (chains.length === 0) {
    throw new Error("WALLET_CHAINS must contain at least one chain");
  }

  const providerUrls: Record<string, string> = {};
  for (const chain of chains) {
    const variableName = `EVM_PROVIDER_URL_${chain.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const url = env[variableName]?.trim();
    if (url) providerUrls[chain] = url;
  }

  return { address: address.toLowerCase(), chains, providerUrls };
}

export function loadRobinhoodChainConfig(env: NodeJS.ProcessEnv = process.env): ChainConfig {
  const rpcUrl = (env.ROBINHOOD_CHAIN_RPC_URL ?? env.EVM_PROVIDER_URL_ROBINHOOD)?.trim();
  if (rpcUrl) {
    try {
      new URL(rpcUrl);
    } catch {
      throw new Error("ROBINHOOD_CHAIN_RPC_URL must be a valid URL");
    }
  }
  return { name: ROBINHOOD_CHAIN_NAME, chainId: ROBINHOOD_CHAIN_ID, ...(rpcUrl ? { rpcUrl } : {}) };
}
