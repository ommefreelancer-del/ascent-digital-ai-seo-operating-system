// Generic, dependency-free helpers for persisting a whole JSON-serializable
// value to a file. Writes are atomic (write to a temp file, then rename) so a
// crash or concurrent read never observes a half-written file, which matters
// for anything used as a durable record (Engineering Standards SS12 Data
// Integrity).

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
