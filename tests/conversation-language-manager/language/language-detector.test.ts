import { describe, expect, it } from "vitest";
import { LanguageDetector } from "../../../src/conversation-language-manager/language/language-detector.js";

describe("LanguageDetector", () => {
  const detector = new LanguageDetector();

  it("defaults to English for a plain English message", () => {
    expect(detector.detect("I need help with my website's SEO.")).toBe("en");
  });

  it("defaults to English for an empty message", () => {
    expect(detector.detect("   ")).toBe("en");
  });

  it("detects Urdu when the message is written in Urdu script", () => {
    expect(detector.detect("مجھے اپنی ویب سائٹ کی مدد چاہیے")).toBe("ur");
  });

  it("does not detect Urdu from a single stray character in an English message", () => {
    expect(detector.detect("Please help با with my site.")).toBe("en");
  });

  it("honors an explicit language override regardless of script", () => {
    expect(detector.detect("I need help with my website.", "ur")).toBe("ur");
    expect(detector.detect("مجھے مدد چاہیے", "en")).toBe("en");
  });
});
