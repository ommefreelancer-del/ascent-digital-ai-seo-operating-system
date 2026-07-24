import { describe, expect, it } from "vitest";
import { NapConsistencyBuilder } from "../../../../src/agents/google-business-profile-agent/reporting/nap-consistency-builder.js";
import type { NapInfo } from "../../../../src/agents/google-business-profile-agent/types/gbp-data-provider.types.js";

const EXPECTED: NapInfo = { name: "Acme Plumbing", address: "123 Main St", phone: "555-1234" };

describe("NapConsistencyBuilder", () => {
  const builder = new NapConsistencyBuilder();

  it("returns isConsistent null with no discrepancies when there is no real listing data", () => {
    expect(builder.build(EXPECTED, null)).toEqual({ isConsistent: null, discrepancies: [] });
  });

  it("reports consistent when the real listing matches exactly", () => {
    const result = builder.build(EXPECTED, { ...EXPECTED });
    expect(result).toEqual({ isConsistent: true, discrepancies: [] });
  });

  it("reports each real, field-level discrepancy", () => {
    const result = builder.build(EXPECTED, { name: "Acme Plumbing", address: "456 Other St", phone: "555-9999" });
    expect(result.isConsistent).toBe(false);
    expect(result.discrepancies).toHaveLength(2);
    expect(result.discrepancies[0]).toContain("address");
    expect(result.discrepancies[1]).toContain("phone");
  });
});
