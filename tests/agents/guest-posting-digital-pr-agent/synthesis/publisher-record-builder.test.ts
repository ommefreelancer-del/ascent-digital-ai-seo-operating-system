import { describe, expect, it } from "vitest";
import { PublisherRecordBuilder } from "../../../../src/agents/guest-posting-digital-pr-agent/synthesis/publisher-record-builder.js";
import type { Prospect } from "../../../../src/agents/prospecting-agent/types/prospecting-request.types.js";
import type { QualifiedProspect } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachStatusEntry } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { NegotiationStatusEntry } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return { url: "https://example.com/blog", domain: "example.com", title: "Example Blog", category: "guest-post", confidence: "high", notes: "Real note.", ...overrides };
}

function makeQualified(overrides: Partial<QualifiedProspect> = {}): QualifiedProspect {
  return { url: "https://example.com/blog", domain: "example.com", title: "Example Blog", decision: "approved", notes: "Real note.", ...overrides };
}

describe("PublisherRecordBuilder", () => {
  const builder = new PublisherRecordBuilder();

  it("returns an empty list for no prospects", () => {
    expect(builder.build([], [], [], [], [])).toEqual([]);
  });

  it("builds a record with all fields null when no downstream activity exists for a domain", () => {
    const [record] = builder.build([makeProspect()], [], [], [], []);
    expect(record).toEqual({
      domain: "example.com",
      title: "Example Blog",
      category: "guest-post",
      qualification: null,
      outreachStatus: null,
      negotiationStatus: null,
      notes: "Real note.",
    });
  });

  it("looks up the real qualification decision for a matching domain", () => {
    const [record] = builder.build([makeProspect()], [makeQualified({ decision: "approved" })], [], [], []);
    expect(record?.qualification).toBe("approved");
  });

  it("looks up a rejected qualification decision as well", () => {
    const [record] = builder.build([makeProspect()], [], [makeQualified({ decision: "rejected" })], [], []);
    expect(record?.qualification).toBe("rejected");
  });

  it("looks up the real outreach status for a matching domain", () => {
    const outreachStatus: OutreachStatusEntry[] = [{ domain: "example.com", status: "drafted", notes: "x" }];
    const [record] = builder.build([makeProspect()], [], [], outreachStatus, []);
    expect(record?.outreachStatus).toBe("drafted");
  });

  it("looks up the real negotiation status for a matching domain", () => {
    const negotiationStatusReport: NegotiationStatusEntry[] = [{ domain: "example.com", status: "negotiating", notes: "x" }];
    const [record] = builder.build([makeProspect()], [], [], [], negotiationStatusReport);
    expect(record?.negotiationStatus).toBe("negotiating");
  });

  it("does not cross-contaminate records for different domains", () => {
    const outreachStatus: OutreachStatusEntry[] = [{ domain: "other.com", status: "drafted", notes: "x" }];
    const [record] = builder.build([makeProspect({ domain: "example.com" })], [], [], outreachStatus, []);
    expect(record?.outreachStatus).toBeNull();
  });
});
