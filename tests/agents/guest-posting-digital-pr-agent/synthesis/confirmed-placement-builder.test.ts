import { describe, expect, it } from "vitest";
import { ConfirmedPlacementBuilder } from "../../../../src/agents/guest-posting-digital-pr-agent/synthesis/confirmed-placement-builder.js";
import type { FinalAgreedPrice } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

describe("ConfirmedPlacementBuilder", () => {
  const builder = new ConfirmedPlacementBuilder();

  it("returns an empty list for no real confirmed pricing", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("echoes every real, human-confirmed pricing agreement", () => {
    const finalAgreedPricing: FinalAgreedPrice[] = [
      { domain: "a.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" },
    ];
    expect(builder.build(finalAgreedPricing)).toEqual([
      { domain: "a.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" },
    ]);
  });

  it("builds one placement per real confirmed agreement", () => {
    const finalAgreedPricing: FinalAgreedPrice[] = [
      { domain: "a.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" },
      { domain: "b.com", agreedPrice: 200, currency: "USD", confirmedAt: "2026-07-06T00:00:00.000Z" },
    ];
    expect(builder.build(finalAgreedPricing)).toHaveLength(2);
  });
});
