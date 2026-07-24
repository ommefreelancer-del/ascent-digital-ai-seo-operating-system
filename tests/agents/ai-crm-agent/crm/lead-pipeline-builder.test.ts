import { describe, expect, it } from "vitest";
import { LeadPipelineBuilder } from "../../../../src/agents/ai-crm-agent/crm/lead-pipeline-builder.js";
import type { ReplyNegotiationResult } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeReplyNegotiation(negotiationStatusReport: ReplyNegotiationResult["negotiationStatusReport"]): ReplyNegotiationResult {
  return {
    requestId: "rn-1",
    dataAvailable: true,
    conversationSummaries: [],
    quotedTerms: [],
    negotiationRecommendations: [],
    replyDrafts: [],
    finalAgreedPricing: [],
    negotiationStatusReport,
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

describe("LeadPipelineBuilder", () => {
  const builder = new LeadPipelineBuilder();

  it("returns no entries when there are no real negotiation statuses", () => {
    expect(builder.build(makeReplyNegotiation([]))).toEqual([]);
  });

  it("relays the real negotiation status and notes unchanged", () => {
    const [entry] = builder.build(
      makeReplyNegotiation([{ domain: "example.com", status: "agreed-confirmed", notes: "Accepted." }]),
    );
    expect(entry).toEqual({ domain: "example.com", stage: "agreed-confirmed", notes: "Accepted." });
  });
});
