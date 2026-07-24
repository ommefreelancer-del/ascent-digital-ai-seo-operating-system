// Structural validation and input-ambiguity detection for an incoming
// WebsiteAuditRequest. Structural problems (empty html, invalid url) throw
// immediately -- a caller-side error. Ambiguous-looking input (HTML that
// doesn't resemble a real rendered page) is reported via looksAmbiguous()
// rather than thrown, so the caller can escalate to a human per
// GLOBAL_RULES.md SS13 instead of silently producing a possibly-meaningless
// audit or silently refusing.

import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { WebsiteAuditRequest } from "../types/website-audit-request.types.js";

export class WebsiteAuditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteAuditValidationError";
  }
}

export class WebsiteAuditRequestValidator {
  /** Throws WebsiteAuditValidationError if the request is structurally invalid. */
  validate(request: WebsiteAuditRequest): void {
    if (!request.html.trim()) {
      throw new WebsiteAuditValidationError("html must not be empty.");
    }

    if (request.url !== undefined) {
      let parsed: URL;
      try {
        parsed = new URL(request.url);
      } catch {
        throw new WebsiteAuditValidationError(`url is not a valid absolute URL: "${request.url}".`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new WebsiteAuditValidationError(
          `url must use http or https (got "${parsed.protocol}"): "${request.url}".`,
        );
      }
    }
  }

  /**
   * True if the supplied HTML lacks both <html> and <body> tags -- a signal
   * this may not be a real rendered page (an error page, a JS-only shell, or
   * unrelated text). Not a hard error, since it could still be legitimate
   * (a deliberately minimal fragment), but risky enough to warrant human
   * confirmation before treating the resulting findings as reliable.
   */
  looksAmbiguous(facts: ExtractedHtmlFacts): boolean {
    return !facts.hasHtmlTag && !facts.hasBodyTag;
  }
}
