// Validates type-specific required properties for a small, explicit set of
// well-known Schema.org types (Organization, Person, WebSite, WebPage,
// BreadcrumbList, FAQPage, Article, LocalBusiness). This is deliberately
// separate from StructuredDataValidationChecker, which only validates the
// generic JSON-LD shape (a real @context + a @type) -- this checker instead
// asks "given the declared @type, does this block have the properties that
// type actually requires". An entity whose @type is not in the list below
// is silently skipped here (still covered by the generic checker), never
// given a fabricated type-specific result.
//
// Required-property lists are intentionally minimal -- Google's structured
// data guidelines' "required" tier, not "recommended" -- so this never flags
// a technically-valid block as broken for lacking an optional field.

import type { AuditChecker, AuditCheckContext } from "./audit-checker.js";
import type { ExtractedHtmlFacts } from "../parsing/html-fact-extractor.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REQUIRED_PROPERTIES_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  Organization: ["name", "url"],
  Person: ["name"],
  WebSite: ["name", "url"],
  WebPage: ["name"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Article: ["headline", "author", "datePublished"],
  LocalBusiness: ["name", "address"],
};

function hasNonEmptyProperty(entity: Record<string, unknown>, prop: string): boolean {
  const value = entity[prop];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length === 0 ? false : true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function typeNamesOf(entity: Record<string, unknown>): string[] {
  const type = entity["@type"];
  if (typeof type === "string" && type.length > 0) return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string" && t.length > 0);
  return [];
}

/** Unwraps a valid "@graph" container into its individual entity records; otherwise treats the block as one entity. */
function extractEntities(parsed: unknown): Record<string, unknown>[] {
  if (isRecord(parsed) && Array.isArray(parsed["@graph"])) {
    return parsed["@graph"].filter(isRecord);
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter(isRecord);
}

export class SchemaTypeChecker implements AuditChecker {
  readonly category = "schema-type-validation";

  check(facts: ExtractedHtmlFacts, _context: AuditCheckContext): AuditFinding[] {
    const parsedBlocks = facts.structuredData.filter((block) => block.parseError === null);
    if (parsedBlocks.length === 0) {
      return [];
    }

    const findings: AuditFinding[] = [];
    let recognizedCount = 0;

    for (const block of parsedBlocks) {
      for (const entity of extractEntities(block.parsed)) {
        for (const typeName of typeNamesOf(entity)) {
          const requiredProps = REQUIRED_PROPERTIES_BY_TYPE[typeName];
          if (!requiredProps) continue; // Unrecognized type -- not fabricated, just not checked here.

          recognizedCount += 1;
          const missing = requiredProps.filter((prop) => !hasNonEmptyProperty(entity, prop));
          if (missing.length > 0) {
            findings.push({
              category: this.category,
              severity: "warning",
              message: `A "${typeName}" structured data block is missing required propert${missing.length > 1 ? "ies" : "y"}: ${missing.join(", ")}.`,
              recommendation: `Add ${missing.map((p) => `"${p}"`).join(", ")} to this ${typeName} JSON-LD block per Schema.org's requirements for that type.`,
            });
          }
        }
      }
    }

    if (recognizedCount > 0 && findings.length === 0) {
      findings.push({
        category: this.category,
        severity: "info",
        message: `${recognizedCount} structured data block(s) of a recognized type (${Object.keys(REQUIRED_PROPERTIES_BY_TYPE).join(", ")}) have all their required properties.`,
        recommendation: "No action required.",
      });
    }

    return findings;
  }
}
