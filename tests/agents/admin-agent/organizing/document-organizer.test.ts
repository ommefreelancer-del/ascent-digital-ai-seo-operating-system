import { describe, expect, it } from "vitest";
import { DocumentOrganizer } from "../../../../src/agents/admin-agent/organizing/document-organizer.js";
import type { InternalDocumentEntry } from "../../../../src/agents/admin-agent/types/admin-request.types.js";

function makeDoc(overrides: Partial<InternalDocumentEntry> = {}): InternalDocumentEntry {
  return { name: "Doc", category: "general", lastUpdatedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

describe("DocumentOrganizer", () => {
  const organizer = new DocumentOrganizer();

  it("returns an empty list for no documents", () => {
    expect(organizer.build([])).toEqual([]);
  });

  it("sorts real documents by category then name", () => {
    const docs = [
      makeDoc({ name: "Zeta SOP", category: "sop" }),
      makeDoc({ name: "Acme Contract", category: "contract" }),
      makeDoc({ name: "Alpha SOP", category: "sop" }),
    ];

    const organized = organizer.build(docs);

    expect(organized.map((d) => d.name)).toEqual(["Acme Contract", "Alpha SOP", "Zeta SOP"]);
  });

  it("carries forward real metadata unchanged", () => {
    const [doc] = organizer.build([makeDoc({ name: "Onboarding Checklist", category: "onboarding", lastUpdatedAt: "2026-03-01T00:00:00.000Z" })]);
    expect(doc).toEqual({ name: "Onboarding Checklist", category: "onboarding", lastUpdatedAt: "2026-03-01T00:00:00.000Z" });
  });
});
