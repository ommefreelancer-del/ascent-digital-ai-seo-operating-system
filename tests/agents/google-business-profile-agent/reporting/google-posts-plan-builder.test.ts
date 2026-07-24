import { describe, expect, it } from "vitest";
import { GooglePostsPlanBuilder } from "../../../../src/agents/google-business-profile-agent/reporting/google-posts-plan-builder.js";

describe("GooglePostsPlanBuilder", () => {
  const builder = new GooglePostsPlanBuilder();

  it("always drafts at least two general post ideas tied to the real business name", () => {
    const posts = builder.build("Acme Plumbing", undefined);
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts.every((p) => p.draftText.includes("Acme Plumbing"))).toBe(true);
  });

  it("every draft requires human approval before publishing", () => {
    const posts = builder.build("Acme Plumbing", undefined);
    expect(posts.every((p) => p.requiresApproval)).toBe(true);
  });

  it("every draft includes a bracketed placeholder rather than a fabricated offer", () => {
    const posts = builder.build("Acme Plumbing", undefined);
    expect(posts.every((p) => /\[.*\]/.test(p.draftText))).toBe(true);
  });

  it("adds a strategy-aligned post when a real local SEO strategy is supplied", () => {
    const withStrategy = builder.build("Acme Plumbing", "Focus on emergency plumbing services.");
    const withoutStrategy = builder.build("Acme Plumbing", undefined);
    expect(withStrategy.length).toBe(withoutStrategy.length + 1);
    expect(withStrategy.some((p) => p.draftText.includes("Focus on emergency plumbing services."))).toBe(true);
  });
});
