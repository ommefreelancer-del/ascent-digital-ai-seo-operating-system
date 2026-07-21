import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonFile, writeJsonFileAtomic } from "../../../src/core/persistence/json-file-store.js";

describe("json-file-store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "boss-agent-json-store-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when the file does not exist", async () => {
    const result = await readJsonFile(join(dir, "missing.json"));
    expect(result).toBeUndefined();
  });

  it("writes and reads back a JSON value, creating missing parent directories", async () => {
    const filePath = join(dir, "nested", "state.json");
    const value = { runId: "abc", tasks: [1, 2, 3] };

    await writeJsonFileAtomic(filePath, value);
    const result = await readJsonFile<typeof value>(filePath);

    expect(result).toEqual(value);
  });

  it("does not leave a temp file behind after a successful write", async () => {
    const filePath = join(dir, "state.json");
    await writeJsonFileAtomic(filePath, { ok: true });

    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual({ ok: true });
    expect(raw.includes(".tmp")).toBe(false);
  });

  it("overwrites an existing file rather than merging with it", async () => {
    const filePath = join(dir, "state.json");
    await writeJsonFileAtomic(filePath, { version: 1 });
    await writeJsonFileAtomic(filePath, { version: 2 });

    const result = await readJsonFile<{ version: number }>(filePath);
    expect(result).toEqual({ version: 2 });
  });

  it("propagates a JSON parse error for a corrupt file instead of returning undefined", async () => {
    const filePath = join(dir, "corrupt.json");
    await writeJsonFileAtomic(filePath, { placeholder: true });
    // Overwrite with invalid JSON directly (bypassing the atomic writer).
    await writeFile(filePath, "{ not valid json", "utf8");

    await expect(readJsonFile(filePath)).rejects.toThrow();
  });
});
