// Flags stale SOPs for review -- per the spec's "Maintain SOPs and
// templates" responsibility. Staleness is a real date comparison against a
// documented general convention (no update in over 180 days is considered
// due for review), not a claim about any specific SOP's actual accuracy,
// consistent with how other agents in this codebase state their own
// thresholds (e.g. the client inactivity window).

import type { InternalDocumentEntry, SopReviewFlag } from "../types/admin-request.types.js";

const REVIEW_THRESHOLD_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class SopReviewFlagBuilder {
  build(internalDocuments: readonly InternalDocumentEntry[], now: Date = new Date()): SopReviewFlag[] {
    return internalDocuments
      .filter((doc) => doc.category === "sop")
      .filter((doc) => (now.getTime() - new Date(doc.lastUpdatedAt).getTime()) / MS_PER_DAY > REVIEW_THRESHOLD_DAYS)
      .map((doc) => ({
        name: doc.name,
        lastUpdatedAt: doc.lastUpdatedAt,
        note: `Not updated in over ${REVIEW_THRESHOLD_DAYS} days; due for review.`,
      }));
  }
}
