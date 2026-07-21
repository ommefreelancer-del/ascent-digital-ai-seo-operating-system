import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlAppender } from "../../../src/core/persistence/jsonl-appender.js";

describe("JsonlAppender", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "boss-agent-jsonl-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the file and its parent directory on first append", async () => {
    const filePath = join(dir, "nested", "log.jsonl");
    const appender = new JsonlAppender(filePath);

    await appender.append({ event: "first" });

    const raw = await readFile(filePath, "utf8");
    expect(raw).toBe('{"event":"first"}\n');
  });

  it("appends each record as its own line, preserving order", async () => {
    const filePath = join(dir, "log.jsonl");
    const appender = new JsonlAppender(filePath);

    await appender.append({ event: "one" });
    await appender.append({ event: "two" });
    await appender.append({ event: "three" });

    const lines = (await readFile(filePath, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["one", "two", "three"]);
  });
});
