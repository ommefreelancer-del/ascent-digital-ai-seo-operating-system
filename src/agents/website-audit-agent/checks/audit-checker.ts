// Shared contract for a single structural check. Each checker consumes the
// facts already extracted from the HTML once (see parsing/html-fact-extractor.ts)
// plus the request's context (url, robots.txt content) -- no checker
// re-parses the raw HTML itself, keeping parsing and rule-checking cleanly
// separated.

import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export interface AuditCheckContext {
  readonly url: string | null;
  readonly robotsTxtContent: string | null;
}

export interface AuditChecker {
  readonly category: string;
  check(facts: ExtractedHtmlFacts, context: AuditCheckContext): AuditFinding[];
}
