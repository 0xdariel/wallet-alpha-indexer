import { readFile, rename, writeFile } from "node:fs/promises";
import type { BlockCursor } from "./rpc.js";
import type { CandidateMetrics } from "./discovery.js";

export interface DiscoverySnapshot {
  cursor: BlockCursor;
  candidates: CandidateMetrics[];
  savedAt: string;
}

export async function saveDiscoverySnapshot(path: string, snapshot: DiscoverySnapshot): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function loadDiscoverySnapshot(path: string): Promise<DiscoverySnapshot | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as DiscoverySnapshot;
    if (!value.cursor || !Number.isSafeInteger(value.cursor.nextBlock) || value.cursor.nextBlock < 0 ||
        !Array.isArray(value.candidates) || typeof value.savedAt !== "string") {
      throw new Error("Discovery snapshot has invalid shape");
    }
    return value;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error instanceof Error ? error : new Error("Unable to load discovery snapshot");
  }
}
