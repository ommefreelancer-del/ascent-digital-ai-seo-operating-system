// Structural validation and low-confidence detection for an incoming
// CompetitorIntelligenceRequest. Structural/data-integrity problems throw
// immediately: an empty competitor list, empty html, an invalid url,
// duplicate competitor ids/urls, or a competitor url that is actually our
// own site (comparing a site against itself). A single-competitor request
// is not an error but is genuinely lower-confidence for drawing competitive
// conclusions, so it is reported via looksLowConfidence() for the caller to
// escalate rather than silently presenting one data point as the
// competitive landscape.

import type { CompetitorIntelligenceRequest } from "../types/competitor-intelligence-request.types.js";

export class CompetitorIntelligenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompetitorIntelligenceValidationError";
  }
}

export class CompetitorIntelligenceRequestValidator {
  /** Throws CompetitorIntelligenceValidationError if the request is structurally invalid. */
  validate(request: CompetitorIntelligenceRequest): void {
    if (request.competitors.length === 0) {
      throw new CompetitorIntelligenceValidationError("competitors must contain at least one entry.");
    }

    let ourHost: string | null = null;
    if (request.ourWebsiteAudit.url) {
      try {
        ourHost = new URL(request.ourWebsiteAudit.url).host;
      } catch {
        ourHost = null;
      }
    }

    const seenIds = new Set<string>();
    const seenUrlKeys = new Set<string>();

    for (const competitor of request.competitors) {
      if (!competitor.html.trim()) {
        throw new CompetitorIntelligenceValidationError(`Competitor "${competitor.id}" has empty html.`);
      }

      if (seenIds.has(competitor.id)) {
        throw new CompetitorIntelligenceValidationError(`Duplicate competitor id: "${competitor.id}".`);
      }
      seenIds.add(competitor.id);

      if (competitor.url === undefined) {
        continue;
      }

      let parsed: URL;
      try {
        parsed = new URL(competitor.url);
      } catch {
        throw new CompetitorIntelligenceValidationError(
          `Competitor "${competitor.id}" has an invalid url: "${competitor.url}".`,
        );
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new CompetitorIntelligenceValidationError(
          `Competitor "${competitor.id}" url must use http or https: "${competitor.url}".`,
        );
      }

      const urlKey = `${parsed.host}${parsed.pathname}`;
      if (seenUrlKeys.has(urlKey)) {
        throw new CompetitorIntelligenceValidationError(`Duplicate competitor url: "${competitor.url}".`);
      }
      seenUrlKeys.add(urlKey);

      if (ourHost !== null && parsed.host === ourHost) {
        throw new CompetitorIntelligenceValidationError(
          `Competitor "${competitor.id}" url host ("${parsed.host}") matches our own site's host; ` +
            "cannot compare a site against itself.",
        );
      }
    }
  }

  /** True when only one competitor was supplied -- too few for a reliable competitive-landscape conclusion. */
  looksLowConfidence(request: CompetitorIntelligenceRequest): boolean {
    return request.competitors.length === 1;
  }
}
