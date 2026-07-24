import { describe, expect, it } from "vitest";
import { classifyDesignRequest } from "../../../../src/agents/graphic-design-agent/drafting/design-request-classifier.js";

describe("classifyDesignRequest", () => {
  it("classifies a YouTube-related request as a youtube-thumbnail", () => {
    expect(classifyDesignRequest("Create a thumbnail for our new YouTube video")).toBe("youtube-thumbnail");
  });

  it("classifies a social-media-related request as a social-media-graphic", () => {
    expect(classifyDesignRequest("Design an Instagram post for the launch")).toBe("social-media-graphic");
  });

  it("classifies an infographic request as an infographic", () => {
    expect(classifyDesignRequest("Build an infographic summarizing our process")).toBe("infographic");
  });

  it("classifies a website-related request as a website-graphic", () => {
    expect(classifyDesignRequest("New hero graphic for the landing page")).toBe("website-graphic");
  });

  it("falls back to marketing-asset for anything unmatched", () => {
    expect(classifyDesignRequest("A generic flyer for the trade show")).toBe("marketing-asset");
  });
});
