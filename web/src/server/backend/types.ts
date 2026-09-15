// Local, minimal type declarations mirroring the frozen backend's own
// result shapes (src/agents/**/types/*.ts in the repo root). The backend
// package is compiled with `declaration: false`, so it ships no .d.ts files
// -- these interfaces are hand-kept in sync with the real backend types we
// actually consume (a small subset of each agent's real, documented output)
// rather than re-exporting backend source across package boundaries.

export interface RoutingCandidate {
  readonly agentId: string;
  readonly agentTitle: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export type RoutingStatusValue = "assigned" | "escalated" | "rejected" | "boss_retained" | "orchestrated" | "human_approval_gate";

/**
 * The real, classified task-workflow intent (mirrors
 * src/boss-agent/routing/task-intent-classifier.ts's TaskIntent) -- see
 * that module's own header for the real production routing defect this
 * closes (a genuine multi-stage client request was scoring low against
 * every specialist and being silently auto-resolved to the closest one).
 */
export type TaskIntentValue = "audit_only" | "advisory_only" | "audit_and_remediate" | "end_to_end_seo" | "remediation_only" | "client_production_validation";

export interface RoutingDecision {
  readonly taskId: string;
  readonly status: RoutingStatusValue;
  readonly assignedAgentId?: string;
  readonly candidates: readonly RoutingCandidate[];
  readonly rationale: string;
  readonly decidedAt: string;
  readonly escalationReason?: string;
  readonly taskIntent?: TaskIntentValue;
}

export interface ClassifiedKeyword {
  readonly keyword: string;
  readonly intent: "informational" | "navigational" | "commercial" | "transactional";
  readonly intentRationale: string;
  readonly metrics: { readonly searchVolume: number; readonly difficulty: number } | null;
}

export interface TopicCluster {
  readonly label: string;
  readonly keywords: readonly string[];
}

export interface KeywordResearchResult {
  readonly requestId: string;
  readonly classifiedKeywords: readonly ClassifiedKeyword[];
  readonly topicClusters: readonly TopicCluster[];
  readonly metricsAvailable: boolean;
  /** REAL, LIVE-OBSERVED DEFECT FIX (2026-09-08): mirrors src/agents/keyword-research-agent/types/keyword-request.types.ts's own field -- whether a real keyword-data provider is wired in at all, independent of whether it returned usable metrics this run. Lets the UI distinguish "nothing configured" from "configured but failed" instead of always showing the same message. */
  readonly metricsProviderConfigured: boolean;
  readonly limitations: readonly string[];
  readonly rankingDisclaimer: string;
  readonly decidedAt: string;
}

export type LinkType = "dofollow" | "nofollow";

export interface ReferringDomainSnapshot {
  readonly domain: string;
  readonly linkingUrl: string;
  readonly anchorText: string;
  readonly linkType: LinkType;
  readonly domainAuthority: number;
  readonly isToxic: boolean;
  readonly spamScore: number | null;
  readonly discoveredAt: string;
}

export interface BacklinkProfile {
  readonly url: string;
  readonly domainAuthority: number;
  readonly totalReferringDomains: number;
  readonly previousTotalReferringDomains: number | null;
  readonly referringDomains: readonly ReferringDomainSnapshot[];
  readonly source: string;
  readonly retrievedAt: string;
}

export interface AuditFinding {
  readonly category: string;
  readonly severity: "info" | "warning" | "critical";
  readonly message: string;
  readonly recommendation: string;
}

export interface WebsiteAuditResult {
  readonly requestId: string;
  readonly url: string | null;
  readonly findings: readonly AuditFinding[];
  readonly summary: { readonly criticalCount: number; readonly warningCount: number; readonly infoCount: number };
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

export interface OnPageRecommendation {
  readonly category: string;
  readonly priority: "high" | "medium" | "low";
  readonly recommendation: string;
  readonly rationale: string;
}

export interface OnPageSeoResult {
  readonly requestId: string;
  readonly url: string | null;
  readonly targetKeyword: string;
  readonly recommendations: readonly OnPageRecommendation[];
  readonly crossFunctionalNotes: readonly string[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

export interface TechnicalSeoRecommendation {
  readonly category: string;
  readonly priority: "high" | "medium" | "low";
  readonly recommendation: string;
  readonly rationale: string;
  readonly confirmedByCrossFunctionalNote: boolean;
}

export interface TechnicalSeoResult {
  readonly requestId: string;
  readonly url: string | null;
  readonly recommendations: readonly TechnicalSeoRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

export interface ContentBrief {
  readonly title: string;
  readonly contentType: "pillar" | "supporting";
  readonly targetKeyword: string;
  readonly intent: string;
  readonly clusterLabel: string;
  readonly relatedKeywords: readonly string[];
  readonly recommendedSections: readonly string[];
  readonly wordCountGuidance: string;
  readonly internalLinks: readonly string[];
}

export interface ContentStrategyResult {
  readonly requestId: string;
  readonly contentBriefs: readonly ContentBrief[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

/**
 * A real, explicitly-selected Pexels image attached to one content section
 * (see backend/content-images.ts). Every field traces to an actual Pexels
 * search hit and the local copy this server downloaded for it -- never a
 * fabricated id/URL/license. Optional: most sections carry no image.
 */
export interface ContentSectionImage {
  readonly sourcePhotoId: number;
  readonly sourceUrl: string;
  readonly imageUrl: string;
  readonly width: number;
  readonly height: number;
  readonly creatorName: string;
  readonly creatorProfileUrl: string;
  readonly altText: string;
  readonly placement: string;
}

export interface ContentSectionDraft {
  readonly heading: string;
  readonly body: string;
  readonly isGenerated: boolean;
  readonly image?: ContentSectionImage;
}

/**
 * IMAGE PIPELINE FIX (2026-09-05): a structured RECOMMENDATION for a visual the article would benefit
 * from -- built from the same real, article-grounded ImageConcept image-concepts.ts already derives
 * (never a second/competing concept-derivation pipeline), so it exists even when NO real Pexels photo
 * could be found/attached (see content-images.ts's own ZERO-IMAGES ROOT CAUSE note). Distinct from
 * ContentSectionImage above: a ContentSectionImage is a REAL, already-downloaded photograph; a
 * ImageRecommendation is a suggestion for a human to source or create one -- never claims an asset exists.
 */
export interface ImageRecommendation {
  /** Where in the article this image belongs, e.g. `After the "How to Get Started" section` -- same phrasing convention as ContentSectionImage.placement. */
  readonly placement: string;
  /** The real, article-grounded visual concept (ImageConcept.query) this recommendation is for. */
  readonly concept: string;
  /** A suggested filename for whoever sources/creates this image -- never a claim that a file exists. */
  readonly filename: string;
  /** Natural, accessible, non-keyword-stuffed suggested alt text for the recommended image -- validated the same way real attached images' alt text is (see content-images.ts's validateAltText()). */
  readonly altText: string;
  /** The real, specific reason this image helps this article (ImageConcept.rationale). */
  readonly purpose: string;
}

export interface FaqItem {
  readonly question: string;
  readonly answerPlaceholder: string;
  readonly isGenerated: boolean;
}

export interface ContentQaSummary {
  readonly passed: boolean;
  readonly failedChecks: readonly string[];
  readonly notes: string;
}

/**
 * PERMANENT PIPELINE FIX (2026-09-06): mirrors src/agents/seo-content-agent/validation/
 * article-purity-validator.ts's own ArticlePurityIssueKind/ArticlePurityIssue for every kind EXCEPT
 * "unfulfilled_image_requirement" -- the agent layer has no concept of images at all (images are a
 * web-layer-only post-processing concern, attached by content-images.ts strictly after the agent already
 * returned), so that one kind is produced ONLY here, never by the agent's own text-only validator. Every
 * other kind is a direct, never-fabricated pass-through of the agent's own real findings.
 */
export type ArticlePurityIssueKind =
  | "seo_title_bleed"
  | "meta_description_bleed"
  | "slug_bleed"
  | "image_recommendation_bleed"
  | "alt_text_bleed"
  | "internal_link_bleed"
  | "qa_diagnostic_bleed"
  | "provider_diagnostic_bleed"
  | "ranking_overclaim"
  | "duplicate_seo_metadata"
  | "malformed_structure"
  | "stale_year_reference"
  /**
   * IMAGE VALIDATION GATE FIX (2026-09-07): a real, genuine visual need this article's own content
   * supported (a real ImageConcept) could not be fulfilled with a real, attached image asset -- only an
   * unfulfilled ImageRecommendation exists for it. Web-layer-only; see content-images.ts's processDraft().
   */
  | "unfulfilled_image_requirement";

export interface ArticlePurityIssue {
  readonly kind: ArticlePurityIssueKind;
  readonly location: string;
  readonly detail: string;
}

export interface ContentPieceDraft {
  readonly title: string;
  readonly contentType: "website-page" | "blog-post";
  readonly targetKeyword: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly sections: readonly ContentSectionDraft[];
  readonly faqs: readonly FaqItem[];
  readonly wordCountGuidance: string;
  readonly internalLinks: readonly string[];
  readonly qaVerdict?: ContentQaSummary | null;
  readonly qaHistory: readonly ContentQaSummary[];
  readonly revisionAttempts: number;
  /** IMAGE PIPELINE FIX (2026-09-05): up to 3 structured image recommendations (see ImageRecommendation above) -- web-layer-only, attached by content-images.ts's attachSupportingImages(), same as `sections[].image`. Never fabricated: empty when the article's own real content doesn't support any real visual concept. */
  readonly imageRecommendations: readonly ImageRecommendation[];
  /** PERMANENT PIPELINE FIX (2026-09-06): "failed_validation" means the real, independent structural gate found supporting-metadata/diagnostic contamination somewhere in this draft's own generated content -- see ArticlePurityIssue above. */
  readonly generationStatus: "ok" | "failed_validation";
  /** True only when generationStatus is "ok", at least one section was genuinely generated, and the QA verdict (when one exists) did not fail. Never true for a structurally-contaminated or entirely-ungenerated draft. */
  readonly publicationReady: boolean;
  /** Real, specific structural findings from the permanent gate -- empty when generationStatus is "ok". */
  readonly purityIssues: readonly ArticlePurityIssue[];
}

export interface SeoContentResult {
  readonly requestId: string;
  readonly contentDrafts: readonly ContentPieceDraft[];
  readonly dataAvailable: boolean;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

export interface KpiDashboardEntry {
  readonly label: string;
  readonly value: string;
  readonly trend: "improving" | "declining" | "stable" | "unknown";
}

export interface AchievementOrChallenge {
  readonly type: "achievement" | "challenge";
  readonly description: string;
}

export interface ClientRecommendation {
  readonly priority: "high" | "medium" | "low";
  readonly recommendation: string;
  readonly rationale: string;
}

export interface ClientReportingResult {
  readonly requestId: string;
  readonly clientName: string;
  readonly reportingPeriodLabel: string;
  readonly executiveSummary: string;
  readonly kpiDashboard: readonly KpiDashboardEntry[];
  readonly achievementsAndChallenges: readonly AchievementOrChallenge[];
  readonly recommendations: readonly ClientRecommendation[];
  readonly dataAvailable: boolean;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

export interface CoreWebVitalsSnapshot {
  readonly lcpMs: number | null;
  readonly inpMs: number | null;
  readonly cls: number | null;
}

export interface LighthouseCategoryScores {
  readonly performance: number | null;
  readonly accessibility: number | null;
  readonly bestPractices: number | null;
  readonly seo: number | null;
}

export interface PerformanceData {
  readonly url: string;
  readonly coreWebVitals: CoreWebVitalsSnapshot | null;
  readonly categoryScores: LighthouseCategoryScores | null;
  readonly source: string;
  readonly retrievedAt: string;
}

export interface GeneratedSection {
  readonly heading: string;
  readonly body: string;
}

// Mirrors src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.ts exactly
// -- see that file's own header: competitors are never discovered/fetched by the agent itself; the caller
// supplies each competitor's real HTML snapshot (and, if known, its real URL) directly, and the agent
// internally reuses the real WebsiteAuditAgent to analyze each one.
export interface CompetitorSnapshot {
  readonly id: string;
  readonly html: string;
  readonly url?: string;
  readonly robotsTxtContent?: string;
}

export interface CompetitorIntelligenceRequest {
  readonly id: string;
  readonly ourWebsiteAudit: WebsiteAuditResult;
  readonly ourTechnicalSeo: TechnicalSeoResult;
  readonly ourKeywordResearch: KeywordResearchResult;
  readonly competitors: readonly CompetitorSnapshot[];
}

export type CompetitorAssessment = "we_are_ahead" | "we_are_behind" | "comparable";

export interface CompetitorOverallGap {
  readonly competitorId: string;
  readonly competitorUrl: string | null;
  readonly ourTotalIssues: number;
  readonly competitorTotalIssues: number;
  readonly assessment: CompetitorAssessment;
}

export type ComparisonAdvantage = "us" | "competitor" | "tie";

export interface TechnicalCategoryComparison {
  readonly category: string;
  readonly ourIssueCount: number;
  readonly competitorIssueCount: number;
  readonly advantage: ComparisonAdvantage;
}

export interface CompetitorTechnicalComparison {
  readonly competitorId: string;
  readonly competitorUrl: string | null;
  readonly categories: readonly TechnicalCategoryComparison[];
}

export interface ContentClusterCoverage {
  readonly clusterLabel: string;
  readonly keywords: readonly string[];
  readonly coveredByCompetitors: readonly string[];
}

export interface CompetitorActionableRecommendation {
  readonly category: string;
  readonly priority: "high" | "medium" | "low";
  readonly recommendation: string;
  readonly rationale: string;
}

export interface CompetitorIntelligenceResult {
  readonly requestId: string;
  readonly competitorGapAnalysis: readonly CompetitorOverallGap[];
  readonly technicalComparison: readonly CompetitorTechnicalComparison[];
  readonly contentGapAnalysis: readonly ContentClusterCoverage[];
  readonly recommendations: readonly CompetitorActionableRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

export interface ConversationResponse {
  readonly sessionId: string;
  readonly language: "en" | "ur";
  readonly intent: "task_request" | "clarification_needed";
  readonly reply: string;
  readonly routingDecision: RoutingDecision | null;
  readonly decidedAt: string;
}
