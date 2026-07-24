import { describe, expect, it } from "vitest";
import { ProspectQualifier } from "../../../../src/agents/publisher-qualification-agent/qualification/prospect-qualifier.js";
import { NullPublisherQualityProvider } from "../../../../src/agents/publisher-qualification-agent/providers/null-publisher-quality-provider.js";
import type {
  PublisherQualityProvider,
  PublisherQualityRequest,
  PublisherQualitySnapshot,
} from "../../../../src/agents/publisher-qualification-agent/types/publisher-quality-provider.types.js";
import type { Prospect } from "../../../../src/agents/prospecting-agent/types/prospecting-request.types.js";

class FixedPublisherQualityProvider implements PublisherQualityProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshot: PublisherQualitySnapshot | null) {}
  async fetchPublisherQuality(_request: PublisherQualityRequest): Promise<PublisherQualitySnapshot | null> {
    return this.snapshot;
  }
}

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    url: "https://example.com/blog",
    domain: "example.com",
    title: "Example Plumbing Blog",
    category: "guest-post",
    confidence: "high",
    notes: "Covers plumbing topics.",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PublisherQualitySnapshot> = {}): PublisherQualitySnapshot {
  return {
    domain: "example.com",
    domainAuthority: 50,
    spamScore: 5,
    estimatedMonthlyTraffic: 10000,
    isNicheRelevant: true,
    source: "fixed-test-provider",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ProspectQualifier", () => {
  const qualifier = new ProspectQualifier();

  it("rejects with no real evidence when no provider is configured", async () => {
    const { qualified, quality } = await qualifier.qualify(new NullPublisherQualityProvider(), makeProspect(), "plumbing");

    expect(quality).toBeNull();
    expect(qualified.decision).toBe("rejected");
    expect(qualified.notes).toContain("No real publisher quality data is available");
  });

  it("approves a real prospect that meets all real quality and relevance criteria", async () => {
    const provider = new FixedPublisherQualityProvider(makeSnapshot());
    const { qualified } = await qualifier.qualify(provider, makeProspect(), "plumbing");

    expect(qualified.decision).toBe("approved");
    expect(qualified.notes).toContain("domain authority 50");
  });

  it("rejects when the real spam score exceeds the documented threshold", async () => {
    const provider = new FixedPublisherQualityProvider(makeSnapshot({ spamScore: 80 }));
    const { qualified } = await qualifier.qualify(provider, makeProspect(), "plumbing");

    expect(qualified.decision).toBe("rejected");
    expect(qualified.notes).toContain("spam score 80");
  });

  it("rejects when the real domain authority is below the documented minimum", async () => {
    const provider = new FixedPublisherQualityProvider(makeSnapshot({ domainAuthority: 5 }));
    const { qualified } = await qualifier.qualify(provider, makeProspect(), "plumbing");

    expect(qualified.decision).toBe("rejected");
    expect(qualified.notes).toContain("domain authority 5");
  });

  it("rejects when neither the real text match nor the provider confirm niche relevance", async () => {
    const provider = new FixedPublisherQualityProvider(makeSnapshot({ isNicheRelevant: false }));
    const irrelevantProspect = makeProspect({ title: "Cooking Blog", notes: "Recipes." });
    const { qualified } = await qualifier.qualify(provider, irrelevantProspect, "plumbing");

    expect(qualified.decision).toBe("rejected");
    expect(qualified.notes).toContain("not confirmed relevant");
  });

  it("approves when the real text match confirms niche relevance even if the provider disagrees", async () => {
    const provider = new FixedPublisherQualityProvider(makeSnapshot({ isNicheRelevant: false }));
    const { qualified } = await qualifier.qualify(provider, makeProspect({ title: "Plumbing Weekly" }), "plumbing");

    expect(qualified.decision).toBe("approved");
  });
});
