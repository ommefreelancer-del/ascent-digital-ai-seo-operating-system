// Validates the SHAPE of successfully-parsed JSON-LD blocks against the
// minimum Schema.org requirements (a real @context referencing schema.org,
// and a @type). PageStructureChecker already flags outright invalid JSON;
// this checker deliberately does not repeat that -- it only evaluates
// blocks that parsed successfully, checking whether they are actually
// usable structured data rather than just syntactically valid JSON.
//
// A top-level object with "@graph" (an array of multiple typed entities,
// e.g. Organization + WebSite + Person sharing one @context) is valid,
// standard Schema.org practice and deliberately has NO @type of its own --
// only the entities inside @graph do. Discovered via the Phase 6 live audit
// against a real @graph-based JSON-LD block, which this checker originally
// flagged as "missing @type" -- a false positive, fixed here by validating
// each @graph entry instead of the graph container itself.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidSchemaOrgContext(context: unknown): boolean {
  if (typeof context === "string") return context.includes("schema.org");
  if (isRecord(context) && typeof context["@vocab"] === "string") return context["@vocab"].includes("schema.org");
  return false;
}

interface EntityCheck {
  readonly hasContext: boolean;
  readonly hasType: boolean;
  readonly isRecord: boolean;
}

function checkEntity(entry: unknown, inheritedContext: unknown): EntityCheck {
  if (!isRecord(entry)) {
    return { hasContext: false, hasType: false, isRecord: false };
  }
  // An entity inside "@graph" normally inherits its @context from the graph
  // container rather than repeating it -- fall back to the inherited value
  // only when the entity doesn't declare its own.
  const context = entry["@context"] ?? inheritedContext;
  return {
    hasContext: hasValidSchemaOrgContext(context),
    hasType: typeof entry["@type"] === "string" && entry["@type"].length > 0,
    isRecord: true,
  };
}

/** Unwraps a valid "@graph" container into its individual entities; otherwise treats the block as one entity. */
function extractEntityChecks(parsed: unknown): EntityCheck[] {
  if (isRecord(parsed) && Array.isArray(parsed["@graph"])) {
    const graphContext = parsed["@context"];
    return parsed["@graph"].map((entry) => checkEntity(entry, graphContext));
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.map((entry) => checkEntity(entry, undefined));
}

export class StructuredDataValidationChecker implements AuditChecker {
  readonly category = "structured-data-validation";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const parsedBlocks = facts.structuredData.filter((block) => block.parseError === null);
    if (parsedBlocks.length === 0) {
      return [];
    }

    const findings: AuditFinding[] = [];
    let validCount = 0;

    for (const block of parsedBlocks) {
      for (const entity of extractEntityChecks(block.parsed)) {
        if (!entity.isRecord) {
          findings.push({
            category: this.category,
            severity: "warning",
            message: "A structured data block does not contain a JSON object (or array of objects).",
            recommendation: "Structure each JSON-LD block as an object with @context and @type.",
          });
          continue;
        }
        if (entity.hasContext && entity.hasType) {
          validCount += 1;
        } else {
          const missing = [!entity.hasContext ? "@context referencing schema.org" : null, !entity.hasType ? "@type" : null].filter(
            (v): v is string => v !== null,
          );
          findings.push({
            category: this.category,
            severity: "warning",
            message: `A structured data block is missing ${missing.join(" and ")}.`,
            recommendation: "Add the missing field(s) so search engines can reliably parse this as Schema.org data.",
          });
        }
      }
    }

    if (validCount > 0 && findings.length === 0) {
      findings.push({
        category: this.category,
        severity: "info",
        message: `${validCount} structured data block(s) have a valid @context and @type.`,
        recommendation: "No action required.",
      });
    }

    return findings;
  }
}
