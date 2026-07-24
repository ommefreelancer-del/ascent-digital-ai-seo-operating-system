// Input/output shapes for the Web Development Agent, per
// Agents/web-development-agent.md. Every development task traces to a real
// input: "seo-implementation" tasks relay the Technical SEO Agent's own
// already-computed recommendations (translating WHAT to fix into an
// implementation-ready ticket -- this agent's own real domain value, per
// its "Support Technical SEO implementation" responsibility); "bug-fix" and
// "feature" tasks are caller-supplied real bug reports and design-asset
// descriptions, passed through verbatim, never fabricated. Responsiveness
// and accessibility (spec Responsibilities) are applied as standing
// acceptance criteria on every feature task rather than invented as
// separate, data-less task categories. With no CodeGenerationProvider
// configured (the default), every task's code is a bracketed placeholder
// instruction, never fabricated code.

import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";
import type { SeoStrategyResult } from "../../seo-strategy-agent/types/seo-strategy-request.types.js";

export interface WebDevelopmentRequest {
  readonly id: string;
  readonly websiteAudit: WebsiteAuditResult;
  readonly technicalSeo: TechnicalSeoResult;
  /** Optional: reflected in prioritization context if supplied, otherwise its absence is stated as a limitation. */
  readonly seoStrategy?: SeoStrategyResult;
  /** Optional free-text business context. Echoed into limitations if omitted, never invented. */
  readonly businessRequirements?: string;
  /** Optional real, caller-supplied bug reports. */
  readonly bugReports?: readonly string[];
  /** Optional real, caller-supplied design asset descriptions (e.g. "Homepage hero redesign, see Figma link"). Never fetched or rendered. */
  readonly designAssets?: readonly string[];
}

export type DevelopmentTaskCategory = "bug-fix" | "feature" | "seo-implementation";
export type DevelopmentTaskPriority = "high" | "medium" | "low";

export interface DraftDevelopmentTask {
  readonly category: DevelopmentTaskCategory;
  readonly priority: DevelopmentTaskPriority;
  readonly title: string;
  readonly description: string;
  readonly rationale: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface DevelopmentTask extends DraftDevelopmentTask {
  /** Real generated code if a CodeGenerationProvider supplied it; otherwise a bracketed placeholder instruction. */
  readonly codeSnippet: string;
  /** True only when `codeSnippet` is real, provider-generated code. */
  readonly isCodeGenerated: boolean;
  /** Always true in this build: deploying any code change requires human approval per GLOBAL_RULES.md SS9. */
  readonly requiresApproval: boolean;
}

export interface WebDevelopmentResult {
  readonly requestId: string;
  /** True only when at least one task received real, provider-generated code. */
  readonly dataAvailable: boolean;
  readonly developmentTasks: readonly DevelopmentTask[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
