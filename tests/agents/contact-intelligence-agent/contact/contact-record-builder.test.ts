import { describe, expect, it } from "vitest";
import { ContactRecordBuilder } from "../../../../src/agents/contact-intelligence-agent/contact/contact-record-builder.js";
import { NullContactDiscoveryProvider } from "../../../../src/agents/contact-intelligence-agent/providers/null-contact-discovery-provider.js";
import type {
  ContactDiscoveryProvider,
  ContactDiscoveryRequest,
  ContactDiscoverySnapshot,
} from "../../../../src/agents/contact-intelligence-agent/types/contact-discovery-provider.types.js";
import type { QualifiedProspect } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";

class FixedContactDiscoveryProvider implements ContactDiscoveryProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshot: ContactDiscoverySnapshot | null) {}
  async discoverContacts(_request: ContactDiscoveryRequest): Promise<ContactDiscoverySnapshot | null> {
    return this.snapshot;
  }
}

function makePublisher(overrides: Partial<QualifiedProspect> = {}): QualifiedProspect {
  return { url: "https://example.com/blog", domain: "example.com", title: "Example Blog", decision: "approved", notes: "x", ...overrides };
}

describe("ContactRecordBuilder", () => {
  const builder = new ContactRecordBuilder();

  it("reports no contact found and no snapshot obtained with the default NullContactDiscoveryProvider", async () => {
    const result = await builder.build(new NullContactDiscoveryProvider(), makePublisher());

    expect(result.snapshotObtained).toBe(false);
    expect(result.isVerified).toBe(false);
    expect(result.record.contactMethod).toBeNull();
    expect(result.record.contactValue).toBeNull();
    expect(result.record.verificationNotes).toContain("No public contact information could be discovered");
  });

  it("reports no contact found but snapshot obtained when the provider ran and found nothing", async () => {
    const provider = new FixedContactDiscoveryProvider({ domain: "example.com", candidates: [], source: "x", retrievedAt: new Date().toISOString() });
    const result = await builder.build(provider, makePublisher());

    expect(result.snapshotObtained).toBe(true);
    expect(result.isVerified).toBe(false);
  });

  it("marks a real, provider-verified candidate as verified", async () => {
    const provider = new FixedContactDiscoveryProvider({
      domain: "example.com",
      candidates: [{ method: "email", value: "hello@example.com", isVerified: true, sourceUrl: "https://example.com/contact" }],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    });

    const result = await builder.build(provider, makePublisher());

    expect(result.isVerified).toBe(true);
    expect(result.record.contactMethod).toBe("email");
    expect(result.record.contactValue).toBe("hello@example.com");
    expect(result.record.verificationNotes).toContain("Verified email contact");
  });

  it("surfaces an unverified real candidate transparently without marking it verified", async () => {
    const provider = new FixedContactDiscoveryProvider({
      domain: "example.com",
      candidates: [{ method: "social-media", value: "@example", isVerified: false, sourceUrl: "https://example.com/about" }],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    });

    const result = await builder.build(provider, makePublisher());

    expect(result.isVerified).toBe(false);
    expect(result.snapshotObtained).toBe(true);
    expect(result.record.contactMethod).toBe("social-media");
    expect(result.record.verificationNotes).toContain("could not be independently verified");
    expect(result.record.verificationNotes).toContain("not forwarded as verified");
  });

  it("prefers a verified candidate over an unverified one of a normally-higher-preference method", async () => {
    const provider = new FixedContactDiscoveryProvider({
      domain: "example.com",
      candidates: [
        { method: "email", value: "unverified@example.com", isVerified: false, sourceUrl: "https://example.com/a" },
        { method: "phone", value: "555-1234", isVerified: true, sourceUrl: "https://example.com/b" },
      ],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    });

    const result = await builder.build(provider, makePublisher());

    expect(result.isVerified).toBe(true);
    expect(result.record.contactMethod).toBe("phone");
  });
});
