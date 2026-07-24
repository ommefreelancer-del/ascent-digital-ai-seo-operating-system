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

  it("does not rotate while the file stays under maxBytes", async () => {
    const filePath = join(dir, "log.jsonl");
    const appender = new JsonlAppender(filePath, { maxBytes: 1024, maxBackups: 2 });

    await appender.append({ event: "one" });
    await appender.append({ event: "two" });

    const lines = (await readFile(filePath, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["one", "two"]);
    await expect(readFile(`${filePath}.1`, "utf8")).rejects.toThrow();
  });

  it("rotates the active file to a .1 backup once it reaches maxBytes", async () => {
    const filePath = join(dir, "log.jsonl");
    const appender = new JsonlAppender(filePath, { maxBytes: 20, maxBackups: 2 });

    await appender.append({ event: "one" });
    await appender.append({ event: "two" });
    await appender.append({ event: "three" });

    const activeLines = (await readFile(filePath, "utf8")).trim().split("\n");
    const backupLines = (await readFile(`${filePath}.1`, "utf8")).trim().split("\n");
    expect(backupLines.map((line) => JSON.parse(line).event)).toEqual(["one", "two"]);
    expect(activeLines.map((line) => JSON.parse(line).event)).toEqual(["three"]);
  });

  it("shifts older backups up and drops the oldest once maxBackups is exceeded", async () => {
    const filePath = join(dir, "log.jsonl");
    const appender = new JsonlAppender(filePath, { maxBytes: 10, maxBackups: 2 });

    await appender.append({ event: "one" });
    await appender.append({ event: "two" });
    await appender.append({ event: "three" });
    await appender.append({ event: "four" });

    const active = (await readFile(filePath, "utf8")).trim().split("\n").map((l) => JSON.parse(l).event);
    const backup1 = (await readFile(`${filePath}.1`, "utf8")).trim().split("\n").map((l) => JSON.parse(l).event);
    const backup2 = (await readFile(`${filePath}.2`, "utf8")).trim().split("\n").map((l) => JSON.parse(l).event);
    expect(active).toEqual(["four"]);
    expect(backup1).toEqual(["three"]);
    expect(backup2).toEqual(["two"]);
  });

  it("never rotates when maxBytes is 0 (rotation disabled)", async () => {
    const filePath = join(dir, "log.jsonl");
    const appender = new JsonlAppender(filePath, { maxBytes: 0 });

    for (let i = 0; i < 20; i += 1) {
      await appender.append({ event: `record-${i}` });
    }

    const lines = (await readFile(filePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(20);
    await expect(readFile(`${filePath}.1`, "utf8")).rejects.toThrow();
  });
});
