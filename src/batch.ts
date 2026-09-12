import type { CandidateMetrics } from "./ingestion/discovery.js";
import { buildWalletPnlReport, type WalletPnlReport, type WalletPnlReportRequest } from "./report.js";

export interface BatchReport {
  fromBlock: number;
  toBlock: number;
  requested: number;
  included: number;
  results: Array<{ address: string; discovery: CandidateMetrics; report?: WalletPnlReport; status: "reported" | "unsupported" | "invalid"; warnings: string[] }>;
}

export async function buildBatchReports(
  candidates: readonly CandidateMetrics[],
  createRequest: (candidate: CandidateMetrics) => WalletPnlReportRequest,
  options: { topN?: number; concurrency?: number } = {},
): Promise<BatchReport> {
  const topN = options.topN ?? candidates.length;
  const concurrency = options.concurrency ?? 2;
  if (!Number.isSafeInteger(topN) || topN < 1) throw new Error("Batch topN must be positive");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("Batch concurrency must be between 1 and 16");
  const selected = [...candidates].sort((a, b) => b.score - a.score || b.transferCount - a.transferCount || a.address.localeCompare(b.address)).slice(0, topN);
  const results: BatchReport["results"] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < selected.length) {
      const index = cursor++;
      const candidate = selected[index];
      if (!candidate) return;
      try {
        const report = await buildWalletPnlReport(createRequest(candidate));
        const status = report.tradeCount > 0 && report.warnings.every((warning) => !warning.includes("excluded from PnL"))
          ? "reported" : report.tradeCount > 0 ? "invalid" : "unsupported";
        results[index] = { address: candidate.address, discovery: candidate, report, status, warnings: report.warnings };
      } catch (error) {
        results[index] = { address: candidate.address, discovery: candidate, status: "invalid", warnings: [error instanceof Error ? error.message : "report failed"] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));
  const ordered = results.filter((result): result is NonNullable<typeof result> => result !== undefined)
    .sort((a, b) => (b.report?.realizedPnlUsd ?? Number.NEGATIVE_INFINITY) - (a.report?.realizedPnlUsd ?? Number.NEGATIVE_INFINITY) || b.discovery.score - a.discovery.score || a.address.localeCompare(b.address));
  const first = selected[0] ? createRequest(selected[0]) : undefined;
  return {
    fromBlock: first?.fromBlock ?? 0,
    toBlock: first?.toBlock ?? 0,
    requested: selected.length,
    included: ordered.filter((result) => result.status === "reported").length,
    results: ordered,
  };
}
