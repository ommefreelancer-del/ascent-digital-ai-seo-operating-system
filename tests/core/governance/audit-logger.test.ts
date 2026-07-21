import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";

describe("AuditLogger", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "boss-agent-audit-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("assigns an id and timestamp and persists the event", async () => {
    const filePath = join(dir, "audit-log.jsonl");
    const logger = new AuditLogger(filePath);

    const event = await logger.logEvent({
      actor: "boss-agent",
      eventType: "task_received",
      details: { taskId: "task-1" },
    });

    expect(event.id).toBeTruthy();
    expect(new Date(event.timestamp).toString()).not.toBe("Invalid Date");
    expect(event.actor).toBe("boss-agent");
    expect(event.eventType).toBe("task_received");
    expect(event.details).toEqual({ taskId: "task-1" });

    const persisted = JSON.parse((await readFile(filePath, "utf8")).trim());
    expect(persisted).toEqual(event);
  });

  it("gives every logged event a unique id", async () => {
    const logger = new AuditLogger(join(dir, "audit-log.jsonl"));

    const first = await logger.logEvent({ actor: "boss-agent", eventType: "a", details: {} });
    const second = await logger.logEvent({ actor: "boss-agent", eventType: "b", details: {} });

    expect(first.id).not.toBe(second.id);
  });
});
