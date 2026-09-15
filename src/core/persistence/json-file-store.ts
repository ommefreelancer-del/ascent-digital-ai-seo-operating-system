// Generic, dependency-free helpers for persisting a whole JSON-serializable
// value to a file. Writes are atomic (write to a temp file, then rename) so a
// crash or concurrent read never observes a half-written file, which matters
// for anything used as a durable record (Engineering Standards SS12 Data
// Integrity).

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Reads and parses a JSON file. Returns `undefined` if the file does not
 * exist yet, so callers can distinguish "no data yet" from "corrupt data"
 * (a JSON parse error still throws).
 */
export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Serializes `value` to JSON and writes it to `filePath` atomically. Creates
 * any missing parent directories first.
 */
export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  await writeFile(tempPath, serialized, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    // Best-effort cleanup of the temp file if the rename itself failed;
    // the original error is what the caller needs to see.
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Synchronous counterpart to {@link readJsonFile}, for the narrow set of
 * callers that cannot become async without a breaking, wide-blast-radius
 * signature change to a hot, synchronous path they sit behind (see
 * ../../boss-agent/routing/routing-rejection-tracker.ts, which durably
 * persists routing-rejection state from inside TaskRouter.route() --
 * deliberately kept synchronous since it's called from dozens of existing
 * call sites, in and out of this repo, that all expect a synchronous
 * RoutingDecision back). Same "undefined means no file yet, a parse error
 * still throws" contract as the async version.
 */
export function readJsonFileSync<T>(filePath: string): T | undefined {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** Synchronous counterpart to {@link writeJsonFileAtomic} -- same temp-file-then-rename atomicity guarantee, same "creates missing parent directories" behavior, for the same narrow synchronous-caller reason documented on {@link readJsonFileSync}. */
export function writeJsonFileAtomicSync(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  writeFileSync(tempPath, serialized, "utf8");
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }
}
