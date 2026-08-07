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

export type RoutingStatusValue = "assigned" | "escalated" | "rejected";

export interface RoutingDecision {
  readonly taskId: string;
  readonly status: RoutingStatusValue;
  readonly assignedAgentId?: string;
  readonly candidates: readonly RoutingCandidate[];
  readonly rationale: string;
  readonly decidedAt: string;
  readonly escalationReason?: string;
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
  readonly limitations: readonly string[];
  readonly rankingDisclaimer: string;
  readonly decidedAt: string;
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

export interface ContentSectionDraft {
  readonly heading: string;
  readonly body: string;
  readonly isGenerated: boolean;
}

export interface FaqItem {
  readonly question: string;
  readonly answerPlaceholder: string;
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

export interface ConversationResponse {
  readonly sessionId: string;
  readonly language: "en" | "ur";
  readonly intent: "task_request" | "clarification_needed";
  readonly reply: string;
  readonly routingDecision: RoutingDecision | null;
  readonly decidedAt: string;
}
