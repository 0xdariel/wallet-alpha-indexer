import { describe, expect, it } from "vitest";
import { loadRobinhoodChainConfig, loadWalletConfig } from "../src/config.js";

describe("loadWalletConfig", () => {
  it("parses a public wallet and configurable chain provider URLs", () => {
    expect(loadWalletConfig({
      WALLET_ADDRESS: "0x0000000000000000000000000000000000000001",
      WALLET_CHAINS: "ethereum, base",
      EVM_PROVIDER_URL_ETHEREUM: "https://example.test/eth",
    })).toEqual({
      address: "0x0000000000000000000000000000000000000001",
      chains: ["ethereum", "base"],
      providerUrls: { ethereum: "https://example.test/eth" },
    });
  });

  it("rejects malformed addresses", () => {
    expect(() => loadWalletConfig({ WALLET_ADDRESS: "not-an-address" })).toThrow("WALLET_ADDRESS");
  });

  it("loads Robinhood Chain mainnet configuration without requiring an endpoint", () => {
    expect(loadRobinhoodChainConfig({
      ROBINHOOD_CHAIN_RPC_URL: "https://rpc.example.test",
    })).toEqual({
      name: "robinhood",
      chainId: 4663,
      rpcUrl: "https://rpc.example.test",
    });
    expect(loadRobinhoodChainConfig({})).toEqual({ name: "robinhood", chainId: 4663 });
  });
});
