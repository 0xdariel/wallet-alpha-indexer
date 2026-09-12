import { describe, expect, it } from "vitest";
import { parseSmokeArgs } from "../src/smoke.js";

describe("live smoke-test guardrails", () => {
  it("requires an explicit URL and bounds the window", () => {
    expect(() => parseSmokeArgs(["--window", "10"])).toThrow("explicit --rpc-url");
    expect(() => parseSmokeArgs(["--rpc-url", "https://rpc.example", "--window", "21"])).toThrow("between 1 and 20");
    expect(parseSmokeArgs(["--rpc-url", "https://rpc.example", "--window", "5", "--timeout-ms", "5000"]))
      .toEqual({ rpcUrl: "https://rpc.example", window: 5, timeoutMs: 5000 });
  });
});
