import { describe, expect, it } from "vitest";
import { ClientProfileBuilder } from "../../../../src/agents/client-relationship-management-agent/synthesis/client-profile-builder.js";
import type { ClientStatusEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";

describe("ClientProfileBuilder", () => {
  const builder = new ClientProfileBuilder();

  it("returns an empty list for no real clients", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("passes through every real client status entry unchanged", () => {
    const clientStatusReport: ClientStatusEntry[] = [
      { clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z" },
    ];
    expect(builder.build(clientStatusReport)).toEqual(clientStatusReport);
  });
});
