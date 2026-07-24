// The 4 technical categories this build can compare deterministically,
// shared between the technical-comparison and recommendation builders.
// Maps TechnicalSeoAgent's own recommendation category names to the
// WebsiteAuditResult finding category a fresh competitor audit uses for the
// same concern ("https" here vs "technical-seo" in WebsiteAuditResult).

export const TECHNICAL_CATEGORIES = ["crawlability", "robots-txt", "https", "page-structure"] as const;

export type TechnicalCategory = (typeof TECHNICAL_CATEGORIES)[number];

export const TECHNICAL_TO_AUDIT_CATEGORY: Record<TechnicalCategory, string> = {
  crawlability: "crawlability",
  "robots-txt": "robots-txt",
  https: "technical-seo",
  "page-structure": "page-structure",
};
