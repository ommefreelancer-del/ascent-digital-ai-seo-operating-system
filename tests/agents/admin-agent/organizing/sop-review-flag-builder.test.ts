import { describe, expect, it } from "vitest";
import { SopReviewFlagBuilder } from "../../../../src/agents/admin-agent/organizing/sop-review-flag-builder.js";
import type { InternalDocumentEntry } from "../../../../src/agents/admin-agent/types/admin-request.types.js";

const NOW = new Date("2026-07-21T00:00:00.000Z");

function makeDoc(overrides: Partial<InternalDocumentEntry> = {}): InternalDocumentEntry {
  return { name: "Outreach SOP", category: "sop", lastUpdatedAt: "2026-06-01T00:00:00.000Z", ...overrides };
}

describe("SopReviewFlagBuilder", () => {
  const builder = new SopReviewFlagBuilder();

  it("returns no flags for no documents", () => {
    expect(builder.build([], NOW)).toEqual([]);
  });

  it("does not flag a non-sop document regardless of age", () => {
    const flags = builder.build([makeDoc({ category: "contract", lastUpdatedAt: "2020-01-01T00:00:00.000Z" })], NOW);
    expect(flags).toEqual([]);
  });

  it("does not flag a recently-updated SOP", () => {
    const flags = builder.build([makeDoc({ lastUpdatedAt: "2026-07-01T00:00:00.000Z" })], NOW);
    expect(flags).toEqual([]);
  });

  it("flags a real SOP not updated in over 180 days", () => {
    const flags = builder.build([makeDoc({ name: "Stale SOP", lastUpdatedAt: "2025-12-01T00:00:00.000Z" })], NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.name).toBe("Stale SOP");
    expect(flags[0]?.note).toContain("180 days");
  });
});
