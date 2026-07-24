import { describe, expect, it } from "vitest";
import { ClientStatusReportBuilder } from "../../../../src/agents/ai-crm-agent/crm/client-status-report-builder.js";
import type { ClientInfoEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";

function makeClient(overrides: Partial<ClientInfoEntry> = {}): ClientInfoEntry {
  return { clientName: "Acme Plumbing", status: "active retainer", lastContactedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

describe("ClientStatusReportBuilder", () => {
  const builder = new ClientStatusReportBuilder();
  const now = new Date("2026-07-10T00:00:00.000Z");

  it("returns no entries for an empty client list", () => {
    expect(builder.build([], now)).toEqual([]);
  });

  it("marks a client contacted within 90 real days as active", () => {
    const [entry] = builder.build([makeClient({ lastContactedAt: "2026-07-01T00:00:00.000Z" })], now);
    expect(entry?.activity).toBe("active");
  });

  it("marks a client not contacted in over 90 real days as inactive", () => {
    const [entry] = builder.build([makeClient({ lastContactedAt: "2026-01-01T00:00:00.000Z" })], now);
    expect(entry?.activity).toBe("inactive");
  });

  it("passes through the real clientName and status unchanged", () => {
    const [entry] = builder.build([makeClient({ clientName: "Acme", status: "prospect" })], now);
    expect(entry).toMatchObject({ clientName: "Acme", status: "prospect" });
  });
});
