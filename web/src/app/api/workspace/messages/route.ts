import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { chatMessageSchema } from "@/lib/validators";
import { sendConversationMessage, getSpecialistAgentSpec, isSystemVerificationRequest } from "@/server/backend/conversation";
import { runSystemReadinessCheck, type SystemReadinessResult } from "@/server/backend/system-readiness";
import { generateSpecialistReply } from "@/server/backend/specialist-ai";
import { buildSearchConsoleContext, buildBingWebmasterContext } from "@/server/backend/performance-analytics";
import { buildGovernanceEvidenceContext } from "@/server/backend/admin-governance";
import { buildCampaignTrackingContext, runCampaignTrackingFromMessage, type CampaignTrackingDispatchResult } from "@/server/backend/campaign-tracking";
import { buildGoogleSheetsContext } from "@/server/backend/google-sheets-integration";
import { buildOffPageSeoContext } from "@/server/backend/off-page-seo";
import { runFullAudit, summarizeAuditForChat, buildAuditFindingsContext, buildOnPageSeoEvidenceContext, type FullAuditResult } from "@/server/backend/website-audit";
import { generateReportFromWorkflowResult } from "@/server/backend/reporting";
import type { ClientReportingResult, SeoContentResult } from "@/server/backend/types";
import { runContentGenerationPipeline, CONTENT_PIPELINE_ENTRY_AGENT_ID, type PipelineStepTrace } from "@/server/backend/specialist-orchestrator";
import { resolveFollowUp, type PreviousCaseSnapshot } from "@/server/backend/follow-up-routing";
import { runTechnicalSeoRemediation, runRemediationFromAuditFindings, resumeVerificationAction, summarizeRemediationForChat, buildRemediationApprovalCardMeta, listPendingApprovals, type RemediationTaskView, type RemediationApprovalCardMeta, type RemediationApprovalView, type PrioritizedFinding, type UnsupportedFinding } from "@/server/backend/remediation";
import { buildDoctorFlowReport, summarizeDoctorFlowForChat, taskReachedExecutionAttempt, runFullReAudit, compareAudits, summarizeReAuditVerificationForChat } from "@/server/backend/doctor-flow";
import { runProspecting, type ProspectingRunResult } from "@/server/backend/prospecting";
import { planWebDevelopmentChange, summarizeWebDevelopmentPlanForChat } from "@/server/backend/web-development";
import { runGraphicDesignRequest, summarizeGraphicDesignForChat } from "@/server/backend/graphic-design";
import { researchKeywords, summarizeKeywordResearchForChat, extractKeywordResearchSubject } from "@/server/backend/keyword-research";
import { runCompetitorIntelligence } from "@/server/backend/competitor-intelligence";
import { getAttachmentMeta, buildAttachmentContext } from "@/server/backend/attachments";
import { processSpreadsheetAttachment, resolveCleaningApprovalReply, looksLikeSpreadsheetOperationRequest, type SpreadsheetCleaningApprovalMeta } from "@/server/backend/spreadsheet-processing";
import { processSelectedGoogleSheet } from "@/server/backend/google-sheets-cleaning";
import { detectExistingOutputTabSelfCleanupRequest, proposeExistingOutputTabCleanupForChat } from "@/server/backend/spreadsheet-existing-output-cleanup";
import { deriveConnectedRepositoryLiveUrl } from "@/server/github";
import { logActivity } from "@/server/log-activity";
import { truncate } from "@/lib/utils";
import { rateLimit } from "@/server/rate-limit";
import type { TaskIntentValue } from "@/server/backend/types";

// Matches the real Website Audit Agent spec id (Agents/website-audit-agent.md,
// parsed by AgentRegistry -- see src/agents/website-audit-agent/dispatch.ts's
// WEBSITE_AUDIT_AGENT_ID for the canonical backend constant this mirrors).
const WEBSITE_AUDIT_AGENT_ID = "website-audit-agent";
const PERFORMANCE_ANALYTICS_AGENT_ID = "performance-analytics-agent";
// PHASE 2 PRODUCTION SECURITY & GOVERNANCE FIX: matches Agents/admin-agent.md's
// filename-derived id. See admin-governance.ts's own header -- before this,
// Admin Agent had no real, read-only access to user-access/RBAC/client-
// isolation/approval-control/audit-log evidence and could only fabricate an
// inspection result or (correctly) decline to answer.
const ADMIN_AGENT_ID = "admin-agent";
// Matches src/boss-agent/routing/task-router.ts's own PROSPECTING_AGENT_ID
// constant (2026-08-16 routing fix) -- the id Agents/prospecting-agent.md's
// filename derives.
const PROSPECTING_AGENT_ID = "prospecting-agent";
// WEB DEVELOPMENT AGENT GITHUB-ACCESS FIX: matches
// src/agents/web-development-agent/dispatch.ts's own WEB_DEVELOPMENT_AGENT_ID
// constant. Without this branch, an assignedAgentId of "web-development-agent"
// fell through to the generic, tool-less Claude role-play branch below --
// correctly routed, but with no real GitHub read/write behind it, which is
// exactly the reported defect (see web-development.ts's own header).
const WEB_DEVELOPMENT_AGENT_ID = "web-development-agent";
// PHASE 3 PERSISTENCE FIX: matches Agents/campaign-tracking-agent.md's
// filename-derived id (src/agents/campaign-tracking-agent/dispatch.ts's own
// CAMPAIGN_TRACKING_AGENT_ID). See campaign-tracking.ts's own header --
// before this, the agent's real CampaignTrackingResult never survived past
// a single reply, and nothing grounded its chat replies in real, persisted
// state.
const CAMPAIGN_TRACKING_AGENT_ID = "campaign-tracking-agent";
// VISUAL-ASSET ROUTING FIX (2026-08-27): matches Agents/graphic-design-agent.md's
// filename-derived id (src/agents/graphic-design-agent/dispatch.ts's own
// GRAPHIC_DESIGN_AGENT_ID constant). See graphic-design.ts's own header --
// before this, a correctly-routed graphic-design-agent assignment (itself
// only possible after the companion routing fix in
// src/boss-agent/routing/tag-weighted-routing-strategy.ts) fell through to
// the generic, tool-less Claude role-play branch below, with no real
// Pixabay call behind it.
const GRAPHIC_DESIGN_AGENT_ID = "graphic-design-agent";
// PHASE 4 LIVE INTEGRATION FIX: matches Agents/google-sheets-integration-agent.md's
// filename-derived id. See google-sheets-integration.ts's own header --
// before this, the agent had no real, read-only access to this account's
// actual Google Sheets connection/health-check evidence and could only
// report "UNKNOWN / NOT VERIFIABLE FROM HERE."
const GOOGLE_SHEETS_INTEGRATION_AGENT_ID = "google-sheets-integration-agent";
// SPREADSHEET FILE PROCESSING WIRING FIX (2026-09-02): the real, normalized fileType values
// attachments.ts's spreadsheet-reader.ts can actually parse locally -- "xls" is deliberately excluded
// (readSpreadsheet() honestly reports it as unsupported; see that module's own header on why a legacy
// binary OLE2/BIFF parser is out of scope without an external dependency this build cannot install).
const SPREADSHEET_FILE_TYPES: ReadonlySet<string> = new Set(["xlsx", "csv"]);
// STEP 3 WIRING FIX: matches Agents/off-page-seo-agent.md's filename-derived
// id (also src/server/backend/specialist-orchestrator.ts's own
// ON_PAGE_SEO_AGENT_ID-adjacent OFF_PAGE_SEO_AGENT_ID convention). See
// off-page-seo.ts's own header -- before this, a real, tested
// DataForSeoBacklinkDataProvider existed but had no caller anywhere in the
// app, so this agent could only role-play backlink analysis with no real
// data to ground it.
const OFF_PAGE_SEO_AGENT_ID = "off-page-seo-agent";
// EXPLICIT-ROUTING/EVIDENCE-RETRIEVAL FIX (2026-09-10): matches
// specialist-orchestrator.ts's own ON_PAGE_SEO_AGENT_ID constant
// (Agents/on-page-seo-agent.md's filename-derived id). Before this, a
// directly/explicitly-assigned on-page-seo-agent decision fell through to
// the generic branch below with no grounding context at all -- see
// buildSavedAuditEvidenceContext()'s own header for the real defect this
// closes (a saved audit's real findings, e.g. the site-wide-internal-linking
// checker's own orphan-page list, never reached this agent; the raw chat
// instruction text was the ONLY input the model ever saw).
const ON_PAGE_SEO_AGENT_ID = "on-page-seo-agent";
// KEYWORD RESEARCH EXECUTION WIRING FIX (2026-09-08): matches
// src/agents/keyword-research-agent/dispatch.ts's own agent id. Before this, a correctly-routed
// keyword-research-agent assignment (score 1.00, see tag-weighted-routing-strategy.ts's own
// hasKeywordResearchIntent()) fell through to the generic, tool-less Claude role-play branch below --
// with no real DataForSEO data to ground it, the model could only honestly report it has no live
// access to keyword-research tools. researchKeywords() (server/backend/keyword-research.ts) already
// wires the real, already-tested DataForSeoKeywordDataProvider -- that real execution path simply had
// zero callers for a direct chat assignment. Reusing it here is the same real provider, no second
// client, no new credential.
const KEYWORD_RESEARCH_AGENT_ID = "keyword-research-agent";
// TECHNICAL SEO EXECUTION WIRING FIX (2026-09-01): matches
// src/agents/technical-seo-agent/dispatch.ts's own TECHNICAL_SEO_AGENT_ID
// constant. Before this, a correctly-routed technical-seo-agent assignment
// fell through to the generic, tool-less Claude role-play branch below --
// with no real WebsiteAuditResult to ground it, the model could only
// honestly report it has no way to perform a live audit (GLOBAL_RULES.md
// SS2 forbids fabricating findings). runFullAudit() already produces a real
// WebsiteAuditResult AND already calls TechnicalSeoAgent.generateRecommendations()
// with it (see website-audit.ts) -- that handoff previously only ran from the
// Website Audit Agent branch below. Reusing it here is the same real pipeline,
// no second crawl, no new integration.
const TECHNICAL_SEO_AGENT_ID = "technical-seo-agent";
// COMPETITOR INTELLIGENCE REAL ORCHESTRATION (2026-09-03): matches
// src/agents/competitor-intelligence-agent/dispatch.ts's own COMPETITOR_INTELLIGENCE_AGENT_ID constant.
// A correctly-routed competitor-intelligence-agent assignment (tag-weighted-routing-strategy.ts's own
// hasCompetitorIntelligenceIntent()) now dispatches to runCompetitorIntelligence() (below), which assembles
// the real Website Audit/Technical SEO/Keyword Research results for the current target, discovers real
// competitors via DataForSEO, fetches their real HTML, and runs the real CompetitorIntelligenceAgent -- see
// competitor-intelligence.ts's own header for the full pipeline. (This previously fell through to the
// generic, tool-less Claude role-play branch with only an honest capability-status disclaimer appended;
// that stopgap is superseded by this real orchestration.)
const COMPETITOR_INTELLIGENCE_AGENT_ID = "competitor-intelligence-agent";
const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/i;
// Fallback for a URL typed without a protocol ("audit example.com"). Deliberately
// conservative: requires a real-looking multi-label domain with a letters-only
// TLD, so it won't fire on ordinary prose like "e.g." or "v1.2". Common
// non-domain file extensions are excluded so "main.js" or "notes.md" don't get
// misread as a website to crawl.
const BARE_DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,}[a-z]{2,}(?:\/[^\s)>\]"']*)?\b/i;
const NON_DOMAIN_TLDS = new Set(["js", "ts", "tsx", "jsx", "py", "md", "txt", "json", "css", "html", "go", "rb", "php", "yml", "yaml"]);
// The two, deliberately narrow real remediation types this system ships
// with (see src/boss-agent/remediation/*.ts's own headers): a missing
// robots.txt, and a mismatched/missing canonical <link> tag on the site's
// own homepage. Requires BOTH a real mention of one of them AND a real
// fix/remediation verb -- a message that only asks to "check" or "audit"
// should not trigger a remediation attempt, only the diagnostic pipeline
// already wired above. runTechnicalSeoRemediation() independently,
// genuinely re-checks BOTH real conditions regardless of which specific
// keyword the user used, and picks whichever is genuinely eligible (see
// its own header) -- this trigger only decides WHETHER to run that real
// check, never WHICH finding it will act on.
const ROBOTS_TXT_MENTION_PATTERN = /\brobots\.txt\b/i;
const CANONICAL_MENTION_PATTERN = /\bcanonical\b/i;
const FIX_INTENT_PATTERN = /\b(fix|repair|resolve|correct)\b/i;
// LIVE VERIFICATION HANDOFF FIX (2026-08-22): a real, live-reproduced defect
// -- a "remediation_only"-classified message that EXPLICITLY asks to verify
// the site's current live state first (e.g. "First verify the current live
// sitemap.") still had auditUrl skipped below (remediation_only's own,
// otherwise-correct "no separate audit stage -- the user already knows the
// finding" design), so no runFullAudit() ever ran this turn; the remediation
// stage then fell back to whatever audit was last PERSISTED for this URL
// (possibly from days/turns earlier), never the fresh state the user
// explicitly asked to check. Matches this exact literal phrasing (the same
// wording task-intent-classifier.ts's own VERIFY_PHRASES targets for
// "verify the live"/"verify the results", just with "current" inserted,
// which that substring list does not match) -- narrow and evidence-grounded
// like every other trigger in this file, not a new classification concept.
//
// FRESH-CRAWL TRIGGER FIX (2026-08-22): a second real, live-reproduced gap in
// the SAME defect -- a differently-worded but equally explicit request
// ("Run a fresh live check of the current sitemap.xml first") never matched
// the single fixed "verify/check the current live" phrase above (different
// word order: "fresh live check" + "current sitemap.xml", not "current
// live"), so it silently fell back to the same stale-persisted-audit path
// this fix was supposed to close. Rather than enumerating every possible
// word order as one more literal phrase, this now requires TWO independent
// signals -- the same "combine two narrow, independent phrase checks"
// convention this file already uses for ROBOTS_TXT_MENTION_PATTERN +
// FIX_INTENT_PATTERN below: (1) a real freshness/liveness signal ("fresh",
// "current live", "live check", or "re-crawl"/"recrawl" -- never bare
// "current" alone, which appears in too many unrelated messages) AND (2) a
// real check/verify-intent word. Both must be present -- an ordinary
// remediation message ("fix every problem", "deploy the approved fix") has
// neither and is correctly unaffected; a bare post-fix "verify the fix" has
// only the second signal and is also correctly unaffected (that already has
// its own, separate resumeVerificationAction()/in-flight-approval path,
// unrelated to whether THIS turn's audit stage runs fresh).
const FRESH_LIVE_SIGNAL_PATTERN = /\bfresh\b|\bcurrent live\b|\blive check\b|\bre-?crawl\b/i;
const CHECK_VERIFY_INTENT_PATTERN = /\bverify\b|\bcheck\b|\bconfirm\b/i;
function isExplicitLiveVerificationRequest(text: string): boolean {
  return FRESH_LIVE_SIGNAL_PATTERN.test(text) && CHECK_VERIFY_INTENT_PATTERN.test(text);
}

function extractUrl(text: string): string | null {
  const withProtocol = text.match(URL_PATTERN);
  if (withProtocol) return withProtocol[0].replace(/[.,;:]+$/, "");

  const bare = text.match(BARE_DOMAIN_PATTERN);
  if (!bare) return null;
  const candidate = bare[0].replace(/[.,;:]+$/, "");
  const tld = candidate.split("/")[0]?.split(".").pop()?.toLowerCase();
  if (!tld || NON_DOMAIN_TLDS.has(tld)) return null;
  return `https://${candidate}`;
}

// EXPLICIT-ROUTING/EVIDENCE-RETRIEVAL FIX (2026-09-10): a real,
// live-reproduced defect -- a directly/explicitly-assigned specialist (e.g.
// "Use the On-Page SEO Agent...") reached via the generic dispatch branch
// below received the raw chat instruction text as its ONLY input, with no
// mechanism to retrieve this workspace's own real, already-persisted
// SeoAudit evidence (findings like the site-wide-internal-linking checker's
// "N page(s) were found only via sitemap.xml, with no internal link..."),
// even when the user's own instruction explicitly asked to "retrieve the
// already-recorded" findings. The model correctly refused to invent the
// missing URLs/counts (the anti-hallucination behavior this fix must never
// weaken) and instead treated the raw instruction text as if it were itself
// the data to analyze/summarize -- an instruction-as-evidence data-contract
// defect, not a model-quality problem.
//
// This reuses the SAME real retrieval this file's own isOrchestrated branch
// already performs for a DIFFERENT dispatch path (see the "DOCTOR FLOW
// COMPLETION"/"EVIDENCE HANDOFF FIX" comments further below,
// db.seoAudit.findFirst scoped by this exact workspace's own userId -- never
// another tenant's) and the SAME real buildAuditFindingsContext() formatter
// (website-audit.ts) -- no new persistence, no new evidence shape, just a
// second real call site for a specialist reached OUTSIDE the orchestrated
// pipeline. Returns an honest "no saved audit evidence" block (never silence,
// never a fabricated summary) when no URL can be resolved or no audit has
// ever been saved for it -- the specialist's own anti-fabrication system
// prompt (specialist-ai.ts's buildSystemPrompt) can then honestly report the
// evidence gap and ask for a fresh audit, instead of guessing.
// ON-PAGE SEO EVIDENCE FIX (2026-09-10): the site-wide summary alone
// (buildAuditFindingsContext -- top 6 non-"info" findings, capped) was
// confirmed insufficient for a genuine on-page SEO audit: page-level
// checks (title/meta, headings, image alt, schema, etc.) only emit a
// finding when something is wrong, and get excluded entirely from a
// non-"info" cap of 6 site-wide issues. buildOnPageSeoEvidenceContext()
// (website-audit.ts) surfaces the REAL, already-computed, per-page
// findings for every on-page category, all severities, with an explicit
// "no findings recorded" line where none exist -- never fabricated. Both
// blocks are included: the site-wide summary still carries evidence like
// the site-wide-internal-linking checker's orphan-page list (needed for a
// genuine internal-linking audit), and the new block carries the specific
// page's own on-page evidence (needed for a genuine on-page audit) --
// clearly, separately labeled, never merged into one undifferentiated
// block.
async function buildSavedAuditEvidenceContext(userId: string, url: string | null): Promise<string> {
  const label = "[SAVED SEO AUDIT EVIDENCE]";
  if (!url) {
    return `${label}\nNo target URL could be resolved from this request, so no saved audit evidence could be looked up. Ask the user for the site URL, or run a fresh audit, before analyzing anything site-specific.`;
  }
  const persistedAudit = await db.seoAudit.findFirst({ where: { userId, url }, orderBy: { createdAt: "desc" }, select: { resultJson: true } });
  if (!persistedAudit) {
    return `${label}\nNo previously-saved SEO audit was found for ${url} in this workspace. Do not invent findings, URLs, or metrics for this site -- report that no saved evidence exists and recommend running a fresh audit first.`;
  }
  try {
    const parsed = JSON.parse(persistedAudit.resultJson) as FullAuditResult;
    return `${buildAuditFindingsContext(url, parsed)}\n\n${buildOnPageSeoEvidenceContext(url, parsed)}`;
  } catch {
    return `${label}\nA saved audit record exists for ${url}, but it could not be read. Do not invent findings for this site -- report that the saved evidence is unreadable and recommend running a fresh audit.`;
  }
}

// STEP 6 PRODUCTION HARDENING (2026-08-21): before this, content the chat
// pipeline generated (specialist-orchestrator.ts's runContentGenerationPipeline)
// was shown once in the reply and then gone -- the dedicated /api/content
// form already persists every draft into ContentDraft, but chat never did.
// This wires the SAME real ContentDraft.create() persistence into the chat
// path, using the exact structured SeoContentResult the real SeoContentAgent
// produced (no re-derivation, no fabricated fields).
//
// ContentDraft.type is a plain String column but the dedicated Content
// Generator form and its library UI (content-generator-shell.tsx) only ever
// write/render one of 4 values: "blog" | "landing-page" | "meta" | "social".
// The real agent's own per-draft classification uses a different, 2-value
// taxonomy ("website-page" | "blog-post") -- mapped here so a chat-originated
// draft still displays correctly if opened later from that same library,
// never a value outside either real taxonomy.
function mapContentDraftType(agentContentType: string): string {
  return agentContentType === "website-page" ? "landing-page" : "blog";
}

/** Persists the real, structured content the chat pipeline produced into the existing ContentDraft library -- never called for an empty/fabricated draft. A failure here never breaks the chat reply itself (see callers' .catch()). */
async function persistChatGeneratedContentDraft(userId: string, content: SeoContentResult): Promise<void> {
  const firstDraft = content.contentDrafts[0];
  if (!firstDraft) return;
  await db.contentDraft.create({
    data: { userId, type: mapContentDraftType(firstDraft.contentType), title: firstDraft.title, resultJson: JSON.stringify(content) },
  });
  await logActivity(userId, "content", `Generated ${firstDraft.contentType.replace(/-/g, " ")} content via AI Workspace chat: "${firstDraft.title}"`);
}

/**
 * PRODUCTION HARDENING (2026-08-15, system-consistency pass): the real,
 * concrete "does this message clearly start a NEW task" signal
 * resolveFollowUp() needs (see follow-up-routing.ts's own header) --
 * computed here, not guessed inside that module, since it requires this
 * route's own extractUrl()/mostRecentAudit lookup. Only "the message names
 * a real, different site than the one the open case is about" counts --
 * anything else (no URL mentioned at all, or the same site) is treated as
 * a genuine continuation, matching this task's own "existing case wins"
 * bias.
 */
function looksLikeNewTaskUrl(message: string, currentCaseUrl: string | null): boolean {
  if (!currentCaseUrl) return false;
  const mentioned = extractUrl(message);
  if (!mentioned) return false;
  try {
    return new URL(mentioned).hostname.toLowerCase() !== new URL(currentCaseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Reports the real ProspectingAgent result -- every domain, evidence URL,
 * snippet, and contact email below traces to a real DataForSEO SERP result
 * and/or a real live page fetch (see runProspecting()'s own header). Never
 * fabricates a metric this pipeline doesn't measure (no DA/DR/traffic --
 * that requires a separate, currently-unconnected Publisher Quality
 * provider) and always says "not independently verified" for a
 * search-result-only match rather than presenting it as confirmed.
 */
/** SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): "investigated https://..." for a real URL-investigation run, or "niche interpreted as X" for an ordinary discovery run -- the two real run modes runProspecting() now supports, never both at once. */
function prospectingRunDescriptor(result: ProspectingRunResult): string {
  return result.investigatedUrl ? `investigated "${result.investigatedUrl}"` : `niche interpreted as "${result.niche}"`;
}

function summarizeProspectingForChat(result: ProspectingRunResult): string {
  if (result.rejected) {
    return (
      `I ran the real Prospecting Agent (provider: "${result.providerName}", ${prospectingRunDescriptor(result)}), but the request ` +
      `did not complete: ${result.rejectionNotes ?? "no further detail was recorded."}`
    );
  }

  if (!result.dataAvailable || result.prospects.length === 0) {
    return (
      `I ran the real Prospecting Agent (provider: "${result.providerName}", ${prospectingRunDescriptor(result)}), but no ` +
      "real guest-posting prospects could be discovered for this request -- nothing was fabricated to fill the gap. " +
      result.limitations.join(" ")
    );
  }

  const lines: string[] = [
    result.investigatedUrl
      ? `Ran the real Prospecting Agent -- live page fetch + evidence verification (${prospectingRunDescriptor(result)}). ` +
        `${result.prospects.length} real prospect record built.`
      : `Ran the real Prospecting Agent -- live DataForSEO SERP search + live page-evidence verification (provider: ` +
        `"${result.providerName}", ${prospectingRunDescriptor(result)}). ${result.prospects.length} real prospect(s) found` +
        `${result.duplicatesRemoved > 0 ? `, ${result.duplicatesRemoved} duplicate(s) removed` : ""}.`,
    "",
  ];

  for (const p of result.prospects) {
    lines.push(`**${p.domain}** -- ${p.verified ? "independently verified" : "not independently verified (search-result match only)"}`);
    lines.push(`- Evidence URL: ${p.evidenceUrl ?? p.url}`);
    if (p.evidenceSnippet) lines.push(`- Evidence: "${p.evidenceSnippet}"`);
    lines.push(`- Contact: ${p.contactEmail ?? "Not found"}${p.contactEmail && p.contactSourceUrl ? ` (source: ${p.contactSourceUrl})` : ""}`);
    if (p.latestArticle !== undefined) {
      // SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): only rendered for a URL-investigation result --
      // absent (not merely `null`) for an ordinary SERP-discovered prospect, which never investigates
      // article-level metadata. Every field individually honest -- "Not verifiable" per GLOBAL_RULES.md
      // SS2, never a guessed date/author when the article itself was found but that field wasn't declared.
      if (p.latestArticle) {
        lines.push(
          `- Latest article: "${p.latestArticle.title}" (${p.latestArticle.url}) -- published: ${p.latestArticle.publicationDate ?? "Not verifiable"}, ` +
            `author: ${p.latestArticle.author ?? "Not verifiable"} (source: ${p.latestArticle.sourceUrl})`,
        );
      } else {
        lines.push("- Latest article: Not found");
      }
    }
    lines.push(`- Qualification: ${p.confidence === "high" && p.verified ? "Qualified" : "Needs Review"}`);
    lines.push("");
  }

  lines.push(
    "This agent performs discovery/investigation only (never contacts a publisher, never negotiates) -- results are " +
      "forwarded to the Publisher Qualification Agent for full quality/relevance assessment and the Contact " +
      "Intelligence Agent for dedicated contact verification (DA/DR/traffic metrics require a separate, " +
      "currently-unconnected Publisher Quality provider, so none are reported here).",
  );

  return lines.join("\n");
}

/**
 * Reports the real, just-persisted-and-read-back CampaignRecord -- every
 * figure below traces to the row runCampaignTrackingFromMessage() verified
 * genuinely round-tripped through the database (create -> save -> read ->
 * verify), never the ephemeral in-memory result alone. No LLM involved.
 */
function summarizeCampaignTrackingForChat({ campaignName, record }: CampaignTrackingDispatchResult): string {
  const { result } = record;
  const lines: string[] = [
    `Tracked and saved real, persisted data for campaign "${campaignName}" -- read back and verified from the database (not just held in memory).`,
    "",
    `**Phase**: ${result.campaignStatus.phase}`,
    `**Approved publishers**: ${result.campaignStatus.totalApprovedPublishers}, drafted: ${result.campaignStatus.draftedCount}, skipped: ${result.campaignStatus.skippedCount}`,
    `**Outreach data available**: ${result.dataAvailable ? "yes" : "no"}`,
  ];

  if (result.progressReports.length > 0) {
    lines.push("", "Progress reports:");
    for (const p of result.progressReports) {
      lines.push(`- ${p.date}: ${p.description}`);
    }
  }

  if (result.limitations.length > 0) {
    lines.push("", ...result.limitations);
  }

  lines.push("", `Last saved: ${record.updatedAt}.`);
  return lines.join("\n");
}

/**
 * Reports the real ClientReportingResult the frozen Client Reporting Agent
 * (via generateReportFromWorkflowResult()) actually produced from this
 * workflow's own real audit/performance data -- no LLM involved, every
 * field traced to the real agent's own structured output.
 */
function summarizeReportForChat(report: ClientReportingResult): string {
  const lines: string[] = [
    `Generated the real client report for "${report.clientName}" (${report.reportingPeriodLabel}) -- every figure below traces to this workflow's own real audit and performance data.`,
    "",
    "**Executive summary**:",
    report.executiveSummary,
  ];

  if (report.kpiDashboard.length > 0) {
    lines.push("", "**KPI dashboard**:");
    for (const kpi of report.kpiDashboard) {
      lines.push(`- ${kpi.label}: ${kpi.value} (${kpi.trend})`);
    }
  }

  if (report.achievementsAndChallenges.length > 0) {
    lines.push("", "**Achievements & challenges**:");
    for (const item of report.achievementsAndChallenges) {
      lines.push(`- [${item.type}] ${item.description}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("", "**Recommendations**:");
    for (const rec of report.recommendations) {
      lines.push(`- [${rec.priority}] ${rec.recommendation} -- ${rec.rationale}`);
    }
  }

  if (report.limitations.length > 0) {
    lines.push("", ...report.limitations);
  }

  return lines.join("\n");
}

/**
 * HUMAN APPROVAL GATE ROUTING FIX (2026-08-19): reports the real,
 * workspace-scoped pending-approval state listPendingApprovals() just read
 * from the database -- no LLM involved, no fabricated/simulated approval
 * state. An empty list is reported honestly as "no pending approval" rather
 * than invented; a real pending row is reported with its real id/status/
 * repository/proposed action so the user can act on it via the existing
 * real Approve/Reject endpoints (api/remediation/approvals/[id]/approve|reject).
 */
function summarizeHumanApprovalGateForChat(pending: readonly RemediationApprovalView[]): string {
  if (pending.length === 0) {
    return (
      "Checked the real, workspace-scoped Human Approval Gate state: no pending approval is currently open for " +
      "this workspace. A pending approval is created when a remediation attempt finds something that requires a " +
      "human decision before it proceeds -- run a remediation to generate one, then ask again to check its status."
    );
  }

  const lines: string[] = [`Checked the real, workspace-scoped Human Approval Gate state: ${pending.length} pending approval(s) found.`, ""];
  for (const approval of pending) {
    lines.push(
      `- **${approval.id}** (${approval.status}) -- ${approval.repositoryFullName}: ${approval.proposedAction} ` +
        `on ${approval.affectedResource}. Expires ${approval.expiresAt}.`,
    );
  }
  lines.push("", "Use the existing Approve/Reject actions on the approval card, or the approvals API, to decide.");
  return lines.join("\n");
}

/**
 * SYSTEM-READINESS EXECUTION FIX (2026-08-19): reports the real, just-executed
 * SystemReadinessResult -- every check's status/detail comes directly from
 * runSystemReadinessCheck()'s own real, read-only application/GitHub-API/
 * database calls, never fabricated, never a hard-coded PASS.
 */
function summarizeSystemReadinessForChat(result: SystemReadinessResult): string {
  const lines: string[] = ["Ran the real, live production-readiness checks for this workspace:", ""];
  for (const check of result.checks) {
    lines.push(`- **${check.name}**: ${check.status} -- ${check.detail}`);
  }
  lines.push("", `**Final: ${result.verdict}**`);
  return lines.join("\n");
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // STEP 6 PRODUCTION HARDENING: the single most expensive route in the app
  // per call (real Boss Agent routing + potentially a real audit, real
  // remediation, real GitHub write, or the real multi-agent content
  // pipeline) -- but also the core interactive feature, where a real active
  // session can legitimately send many messages in a short span. 60 messages
  // per 15 minutes per user is well above realistic human chat cadence while
  // still bounding cost/load from a runaway script or accidental loop.
  if (!rateLimit(`workspace:messages:${session.user.id}`, 60, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many messages sent recently. Please wait a few minutes and try again." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = chatMessageSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { message, attachmentId } = parsed.data;
  const userId = session.user.id;

  // WORKSPACE FILE ATTACHMENT CAPABILITY: re-verifies real ownership of a supplied attachmentId before
  // ever linking it to a task -- an attachmentId the client sent that doesn't exist or belongs to a
  // different workspace is a real error (a bug or tampering attempt), never silently dropped, so the
  // user is never left thinking a file was attached when it wasn't.
  let attachmentMeta = null as Awaited<ReturnType<typeof getAttachmentMeta>>;
  if (attachmentId) {
    attachmentMeta = await getAttachmentMeta(userId, attachmentId);
    if (!attachmentMeta) {
      return NextResponse.json({ error: "That attachment could not be found for this workspace. Please re-attach the file and try again." }, { status: 400 });
    }
  }
  const attachmentContext = attachmentMeta ? buildAttachmentContext(attachmentMeta) : null;

  try {
    // A JWT session can still decode successfully after its underlying user
    // row is gone (e.g. the account was deleted or the dev DB was reset).
    // Without this check, chatSession.create() below fails with an unhandled
    // Prisma foreign-key error, which Next.js turns into a response with no
    // JSON body -- the exact cause of the frontend's "Unexpected end of JSON
    // input" error. Fail fast here with a real, parseable error instead.
    const userExists = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      return NextResponse.json({ error: "Your session refers to an account that no longer exists. Please sign out and sign in again." }, { status: 401 });
    }

    let chatSession = parsed.data.sessionId
      ? await db.chatSession.findFirst({ where: { id: parsed.data.sessionId, userId } })
      : null;
    if (!chatSession) {
      chatSession = await db.chatSession.create({ data: { userId, title: truncate(message, 60) } });
    }

    // Looked up BEFORE creating this turn's user/assistant messages, so this
    // is genuinely the *previous* completed task's real state -- never
    // guessed. Two DIFFERENT "previous" concepts, deliberately queried
    // separately (conflating them into one lookup was itself a real bug
    // caught during this same hardening pass):
    //   - `lastRealAgentAssignment`: the last turn that had a real
    //     agentId set, SKIPPING any intervening turn that didn't (e.g. an
    //     escalated or orchestrated turn never sets one -- see
    //     routing.types.ts's own doc comment). This is the original,
    //     already-proven semantics Rule 3 (Website Audit Agent follow-up)
    //     depends on -- unchanged.
    //   - `mostRecentAssistantMessage`: the literal most recent assistant
    //     turn, regardless of agentId -- what Rule 2 (open orchestrated
    //     case) needs, since an open case's own most recent state IS what
    //     "resume" means; skipping past an intervening turn here would
    //     resume a case the conversation has already moved on from.
    const [lastRealAgentAssignment, mostRecentAssistantMessage] = await Promise.all([
      db.chatMessage.findFirst({
        where: { sessionId: chatSession.id, role: "assistant", agentId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { agentId: true },
      }),
      db.chatMessage.findFirst({
        where: { sessionId: chatSession.id, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select: { status: true, metaJson: true },
      }),
    ]);
    let previousTaskIntent: string | null = null;
    if (mostRecentAssistantMessage?.metaJson) {
      try {
        const parsed = JSON.parse(mostRecentAssistantMessage.metaJson) as { routingDecision?: { taskIntent?: string } };
        previousTaskIntent = parsed.routingDecision?.taskIntent ?? null;
      } catch {
        previousTaskIntent = null;
      }
    }
    const previousCase: PreviousCaseSnapshot = {
      assignedAgentId: lastRealAgentAssignment?.agentId ?? null,
      status: mostRecentAssistantMessage?.status ?? null,
      taskIntent: previousTaskIntent,
    };

    const userMessage = await db.chatMessage.create({
      data: { sessionId: chatSession.id, role: "user", content: message, attachmentId: attachmentMeta?.id ?? null },
    });

    // The same real, single source of truth every URL-fallback in this
    // route already relied on (three separate call sites previously each
    // ran this identical query) -- looked up once, here, so it can ALSO
    // answer "does this message clearly name a different site than the
    // open case's own" (see `looksLikeNewTask` below) without a redundant
    // extra round-trip.
    const mostRecentAudit = await db.seoAudit.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { url: true } });

    // REPOSITORY-TARGET RESOLUTION FIX (2026-08-19): a live-tested defect --
    // every URL-resolution fallback in this route defaulted straight to
    // `mostRecentAudit?.url` (whatever site was most recently audited in
    // this account's history) whenever the message named no explicit URL,
    // completely ignoring which repository is actually connected via
    // GitHub Integrations. A genuine Phase 5 request naming no URL was
    // silently re-auditing a stale, unrelated site instead of the
    // currently connected one. `connectedRepositoryLiveUrl` -- derived
    // structurally (never a live fetch) via github.ts's own
    // deriveConnectedRepositoryLiveUrl() -- is now inserted as a fallback
    // tier ahead of `mostRecentAudit?.url` at every resolution site below,
    // making the currently connected repository authoritative. `null` when
    // there is no active connection (or no repository has been selected
    // yet), in which case resolution falls through to `mostRecentAudit?.url`
    // exactly as before -- unchanged for any workspace with no GitHub
    // connection at all.
    const activeGitHubConnection = await db.gitHubConnection.findUnique({ where: { userId }, select: { accountLogin: true, repositoryFullName: true, status: true } });
    const connectedRepositoryLiveUrl =
      activeGitHubConnection && activeGitHubConnection.status !== "revoked" && activeGitHubConnection.status !== "invalid" && activeGitHubConnection.repositoryFullName
        ? deriveConnectedRepositoryLiveUrl(activeGitHubConnection.accountLogin, activeGitHubConnection.repositoryFullName)
        : null;

    // ATTACHMENT-AWARE HISTORICAL-URL GUARD (2026-09-02): a real, live-observed defect -- an
    // attachment-bearing message with no explicit URL of its own was still silently falling back to
    // connectedRepositoryLiveUrl/mostRecentAudit's stale, unrelated PREVIOUS site at several dispatch
    // sites below (OFF_PAGE_SEO_AGENT_ID's grounding context and GRAPHIC_DESIGN_AGENT_ID's dispatch are
    // reached via ORDINARY specialist scoring, not just the isOrchestrated branch already guarded here)
    // -- producing exactly the reported "previous portfolio/SEO context" contamination even after
    // task-intent-classifier.ts's own CONTEXT_ISOLATION_PHRASES fix corrected the classification itself.
    // A real attachment with no URL in the message is presumptively a file-based task, not a
    // website-based one, so every one of this route's historical-URL fallback sites now shares this one
    // guarded value instead of separately repeating (and separately risking re-introducing) the
    // unguarded chain.
    const historicalUrlFallback = attachmentMeta ? null : (connectedRepositoryLiveUrl ?? mostRecentAudit?.url ?? null);

    // WORKSPACE FILE ATTACHMENT CAPABILITY: routing (and, below, the generic specialist-reply branch)
    // sees the real, disclosed fact that a file was attached and its name/type -- "file-aware routing"
    // -- while the PERSISTED/DISPLAYED userMessage.content above stays exactly what the user typed,
    // never silently rewritten.
    const routingMessage = attachmentContext ? `${message}\n\n${attachmentContext}` : message;

    let result;
    try {
      result = await sendConversationMessage(chatSession.id, routingMessage);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The AI Workspace could not process that message.";
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    let { response, escalations } = result;
    let decision = response.routingDecision;

    // CASE CONTINUITY (2026-08-15, system-consistency pass; supersedes the
    // 2026-08-14 Website-Audit-Agent-only override): a single, unified
    // decision -- see follow-up-routing.ts's own "CASE CONTINUITY" header
    // for the real, confirmed production defect this fixes (a follow-up to
    // an open, Boss-owned end_to_end_seo case, e.g. "show me the findings",
    // was being silently re-routed back to Website Audit Agent, discarding
    // Boss's ownership of the case). `looksLikeNewTaskUrl` is the one
    // concrete "this is clearly a new task" signal computed here (route.ts
    // owns extractUrl()/mostRecentAudit); resolveFollowUp() itself never
    // guesses it.
    const looksLikeNewTask = looksLikeNewTaskUrl(message, mostRecentAudit?.url ?? null);
    const followUp = await resolveFollowUp(previousCase, decision?.status, decision?.rationale, message, looksLikeNewTask);

    if (followUp.kind === "resume_orchestrated_case") {
      const resumedDecision = {
        taskId: decision?.taskId ?? randomUUID(),
        status: "orchestrated" as const,
        taskIntent: followUp.taskIntent as TaskIntentValue,
        candidates: [],
        rationale: `Continuing the existing Boss-owned case (classified as "${followUp.taskIntent}") -- this follow-up resumes the same case rather than being freshly routed.`,
        decidedAt: new Date().toISOString(),
      };
      response = {
        ...response,
        intent: "task_request",
        reply: `Continuing the existing Boss-owned workflow (${followUp.taskIntent}) -- resuming where we left off.`,
        routingDecision: resumedDecision,
      };
      decision = resumedDecision;
      // The fresh (contextless) attempt's own escalation, if any, never
      // actually reached the user under the resumed case -- don't record it
      // as if it did.
      escalations = [];
    } else if (followUp.kind === "route_back_to_website_audit") {
      const { matchedTerm } = followUp;
      const overrideDecision = {
        taskId: decision?.taskId ?? randomUUID(),
        status: "assigned" as const,
        assignedAgentId: WEBSITE_AUDIT_AGENT_ID,
        candidates: [{ agentId: WEBSITE_AUDIT_AGENT_ID, agentTitle: "Website Audit Agent", score: 1, matchedTerms: [matchedTerm] }],
        rationale: `Follow-up to the previous Website Audit Agent task (matched term: "${matchedTerm}") -- routed back automatically instead of re-scoring through the Boss Agent.`,
        decidedAt: new Date().toISOString(),
      };
      response = {
        ...response,
        intent: "task_request",
        reply: `This has been routed back to "website-audit-agent" -- it's a follow-up to the previous Website Audit Agent task (matched term: "${matchedTerm}").`,
        routingDecision: overrideDecision,
      };
      decision = overrideDecision;
      escalations = [];
    } else if (followUp.kind === "route_back_to_google_sheets_integration") {
      // GOOGLE SHEETS RE-VALIDATION FOLLOW-UP FIX (2026-09-15): symmetric to route_back_to_website_audit
      // above -- see follow-up-routing.ts's own header (search "GOOGLE SHEETS RE-VALIDATION") for the
      // real, live-reported defect this closes. A follow-up like "Now validate this live -- run it again
      // and confirm the result." was live-observed scoring "Website Audit Agent" at 0.44 (below the 0.50
      // auto-assign threshold) and failing to route at all -- the Task Progress UI showed "Rejected"
      // even though route.ts's own dispatch below still produced a correct, fresh Google Sheets cleaning
      // reply. This constructs a genuine "assigned to google-sheets-integration-agent" decision instead,
      // so the displayed/persisted routing state matches what actually happens: the existing, unchanged
      // dispatch branches further below (gated on `decision.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID`)
      // then naturally pick this up and route to processSelectedGoogleSheet()/
      // proposeExistingOutputTabCleanupForChat() -- never a second, parallel dispatch mechanism.
      const { matchedTerm } = followUp;
      const overrideDecision = {
        taskId: decision?.taskId ?? randomUUID(),
        status: "assigned" as const,
        assignedAgentId: GOOGLE_SHEETS_INTEGRATION_AGENT_ID,
        candidates: [{ agentId: GOOGLE_SHEETS_INTEGRATION_AGENT_ID, agentTitle: "Google Sheets Integration Agent", score: 1, matchedTerms: [matchedTerm] }],
        rationale: `Follow-up to the previous Google Sheets Integration Agent task (matched term: "${matchedTerm}") -- routed back automatically instead of re-scoring through the Boss Agent.`,
        decidedAt: new Date().toISOString(),
      };
      response = {
        ...response,
        intent: "task_request",
        reply: `This has been routed back to "google-sheets-integration-agent" -- it's a follow-up to the previous Google Sheets Integration Agent task (matched term: "${matchedTerm}").`,
        routingDecision: overrideDecision,
      };
      decision = overrideDecision;
      escalations = [];
    }

    // The Boss Agent's RoutingDecision above is untouched. Once a task is
    // actually assigned, decide how to produce the specialist's real work
    // product:
    //   - Website Audit Agent + a URL in the message -> run the real
    //     production pipeline (runFullAudit: crawl, robots.txt, sitemap.xml,
    //     headers, Lighthouse, schema, links, accessibility) and reply with
    //     its real, evidence-based output. No LLM involved in producing the
    //     findings -- every number traces directly to the pipeline.
    //   - SEO Content Agent -> run the real automatic multi-agent content
    //     pipeline (specialist-orchestrator.ts): Keyword Research -> SEO
    //     Strategy -> SEO Content -> On-Page SEO (internal linking + meta) ->
    //     Guest Posting (only when requested). Each stage's real output is
    //     fed to the next as already-provided context, so the content agent
    //     never has to ask the user for data another specialist can supply.
    //   - Everything else -> ask Claude to role-play that specialist agent's
    //     real Agents/*.md spec, as before. If no API key is configured or
    //     the call fails, fall back to the routing-only reply rather than
    //     fabricating a response or failing the request.
    //   - decision.status === "orchestrated" (2026-08-15 routing fix) -> a
    //     real, multi-stage SEO workflow the Boss Agent owns end-to-end (see
    //     src/boss-agent/routing/task-intent-classifier.ts's own header for
    //     the real production defect this fixes: a genuinely complex client
    //     request was scoring low against every individual specialist and
    //     being silently auto-resolved to the closest one, e.g. Website
    //     Audit Agent, which correctly reported it doesn't own remediation/
    //     approval/deployment/verification and the turn ended there). No
    //     specialist is ever assigned for this status; NEVER let a
    //     specialist become the terminal handler for an orchestration task.
    //     Reuses the exact same real pipelines as the branches above
    //     (runFullAudit for the audit stage below, runTechnicalSeoRemediation
    //     for the remediation stage further down) -- this is Boss
    //     dispatching to Website Audit Agent and then resuming control, not
    //     a second, parallel execution system.
    const isOrchestrated = decision?.status === "orchestrated";
    let assistantContent = response.reply;
    let auditResult: FullAuditResult | null = null;
    let auditUrl: string | null = null;
    let pipelineTrace: readonly PipelineStepTrace[] | null = null;
    let remediationApproval: RemediationApprovalCardMeta | null = null;
    let spreadsheetCleaningApproval: SpreadsheetCleaningApprovalMeta | null = null;
    let reportId: string | null = null;
    // DOCTOR FLOW COMPLETION (2026-08-21): hoisted to this outer scope so the
    // continuation block further below (which runs on a LATER turn once a
    // real human decision has been made) can see this SAME turn's real
    // remediation task/strategy without re-deriving or fabricating it.
    let remediationTask: RemediationTaskView | null = null;
    let prioritizedFindingsForDoctorFlow: readonly PrioritizedFinding[] = [];
    let unsupportedFindingsForDoctorFlow: readonly UnsupportedFinding[] = [];
    let findingsResultForWorkflow: FullAuditResult | null = null;

    if (
      decision?.status === "assigned" &&
      (decision.assignedAgentId === WEBSITE_AUDIT_AGENT_ID || decision.assignedAgentId === TECHNICAL_SEO_AGENT_ID)
    ) {
      // Same real extraction Website Audit Agent already uses -- a technical-seo-agent assignment
      // only triggers the real pipeline when the message itself names a URL, exactly like Website
      // Audit Agent's own behavior (no broader mostRecentAudit/connectedRepositoryLiveUrl fallback,
      // which is reserved for the Boss-owned orchestrated workflow below).
      auditUrl = extractUrl(message);
    } else if (isOrchestrated && (decision?.taskIntent !== "remediation_only" || isExplicitLiveVerificationRequest(message))) {
      // AUDIT stage of a Boss-owned orchestrated workflow (audit_and_remediate
      // / end_to_end_seo / client_production_validation): reuses the exact
      // same real fallback chain the remediation trigger below already uses
      // -- a message like "Audit this website..." rarely repeats a URL that
      // was already given earlier in the session. "remediation_only" skips
      // this (no audit stage by definition -- see task-intent-classifier.ts)
      // and resolves its own URL directly in the remediation block below --
      // UNLESS the message explicitly asks to verify the current live state
      // first (isExplicitLiveVerificationRequest(), see its own comment
      // above), in which case a real, fresh runFullAudit() below is exactly
      // what was asked for.
      // ATTACHMENT-AWARE AUDIT-URL GUARD (2026-09-02): see historicalUrlFallback's own header --
      // an attachment-bearing message with no explicit URL of its own must never silently fall back to
      // a stale, unrelated previous audit target.
      auditUrl = extractUrl(message) ?? historicalUrlFallback;
    }

    // SPREADSHEET CLEANING APPROVAL REPLY (2026-09-02): checked BEFORE ordinary routing/dispatch for
    // every message -- mirrors the existing in-flight remediation-approval-resume precedent further
    // below (inFlightApproval), since a bare "approve"/"reject" reply rarely scores well against any
    // specialist through ordinary intent routing on its own. Only ever acts when a real pending
    // SpreadsheetCleaningApproval exists for this user AND the message is a recognizable decision --
    // anything else leaves `handled: false`, so the rest of this route's normal dispatch logic below
    // runs completely unaffected.
    const cleaningApprovalReply = await resolveCleaningApprovalReply(userId, message);

    // HARD COST-PROTECTION GUARD (2026-09-02): see looksLikeSpreadsheetOperationRequest()'s own header
    // in spreadsheet-processing.ts -- a real, live-confirmed production-safety requirement. Runs
    // BEFORE `decision?.status`/`isOrchestrated` are ever consulted below, so a real spreadsheet-type
    // attachment paired with an explicit spreadsheet-operation request is STRUCTURALLY routed to the
    // real, local-only processSpreadsheetAttachment() regardless of what classifyTaskIntent()/
    // TagWeightedRoutingStrategy decided -- a future gap in either of THOSE phrase lists (both already
    // hit real gaps once) can never again let a spreadsheet-only task reach an Anthropic/Gemini/
    // DataForSEO-dependent branch (auditUrl/runFullAudit, runContentGenerationPipeline,
    // generateSpecialistReply, etc.). This is a structural bypass, not a prompt instruction.
    const forceSpreadsheetProcessing =
      !cleaningApprovalReply.handled && Boolean(attachmentMeta) && SPREADSHEET_FILE_TYPES.has(attachmentMeta!.fileType) && looksLikeSpreadsheetOperationRequest(message);

    if (cleaningApprovalReply.handled) {
      assistantContent = cleaningApprovalReply.reply!;
    } else if (forceSpreadsheetProcessing) {
      try {
        const processingResult = await processSpreadsheetAttachment(userId, attachmentMeta!);
        assistantContent = processingResult.reply;
        spreadsheetCleaningApproval = processingResult.approvalMeta ?? null;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `I found the attached file "${attachmentMeta!.originalFileName}", but reading it failed: ${reason}`;
      }
    } else if (decision?.status === "human_approval_gate") {
      // HUMAN APPROVAL GATE ROUTING FIX (2026-08-19): reaches the real
      // pending-approval state directly -- never falls into the auditUrl/
      // runFullAudit branches below, so an explicit gate request never
      // triggers a live SEO audit. See listPendingApprovals()'s own header
      // and task-router.ts's new "human_approval_gate" status.
      try {
        const pending = await listPendingApprovals(userId);
        assistantContent = summarizeHumanApprovalGateForChat(pending);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The pending-approval state could not be read.";
        assistantContent = `I tried to check the real Human Approval Gate state for this workspace, but it failed: ${reason}`;
      }
    } else if (decision?.status === "boss_retained" && (await isSystemVerificationRequest(message))) {
      // SYSTEM-READINESS EXECUTION FIX (2026-08-19): "boss_retained" alone
      // used to fall through to a generic routing-rationale echo -- no
      // check ever actually ran. isSystemVerificationRequest() reuses the
      // exact same real, pure detector task-router.ts's own routing
      // decision was produced from (no routing logic duplicated or
      // changed) to recognize SPECIFICALLY a system-readiness verification
      // request, as opposed to an ordinary meta-request about Boss's own
      // routing machinery (which still falls through to the generic reply,
      // unaffected). Never touches auditUrl/runFullAudit -- a
      // system-readiness check never triggers a live SEO audit.
      try {
        const result = await runSystemReadinessCheck(userId, { taskId: decision.taskId, rationale: decision.rationale });
        assistantContent = summarizeSystemReadinessForChat(result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The system-readiness checks could not be completed.";
        assistantContent = `I tried to run the real production-readiness checks for this workspace, but it failed: ${reason}`;
      }
    } else if (auditUrl) {
      try {
        // ACCESS-EVIDENCE FIX (2026-09-11): a real, confirmed gap -- a
        // directly-assigned technical-seo-agent/website-audit-agent request
        // ALWAYS ran a brand-new live crawl here, even when a completed
        // audit for this EXACT URL already existed in this workspace --
        // "access the evidence from the previous task" was structurally
        // impossible, since the previous task's real evidence was never
        // looked up, only silently replaced by a fresh one every turn. This
        // reuses the SAME real db.seoAudit.findFirst(userId, url) lookup
        // already used elsewhere in this file (remediation trigger, workflow
        // continuation) -- same tenant-scoping (userId), same "most recent
        // for this exact URL" selection, no new persistence. Still runs a
        // genuinely fresh audit -- never silently substitutes stale data --
        // when the message explicitly asks for current/live results
        // (isExplicitLiveVerificationRequest(), the SAME real signal this
        // file already uses for this exact "does the user want fresh data"
        // decision elsewhere), or when no persisted audit exists yet for
        // this URL.
        let usedPersistedEvidence = false;
        if (!isExplicitLiveVerificationRequest(message)) {
          const persistedAuditForUrl = await db.seoAudit.findFirst({ where: { userId, url: auditUrl }, orderBy: { createdAt: "desc" }, select: { resultJson: true, createdAt: true } });
          if (persistedAuditForUrl) {
            try {
              auditResult = JSON.parse(persistedAuditForUrl.resultJson) as FullAuditResult;
              usedPersistedEvidence = true;
            } catch {
              auditResult = null;
            }
          }
        }
        if (!auditResult) {
          auditResult = await runFullAudit(auditUrl, "");
        }
        const summary = usedPersistedEvidence
          ? summarizeAuditForChat(
              auditUrl,
              auditResult,
              `Reusing this workspace's saved technical SEO audit for ${auditUrl} (from ${auditResult.crawl.decidedAt}) -- not a fresh live crawl this turn. Ask for a "fresh"/"current live" check to force a new crawl.`,
            )
          : summarizeAuditForChat(auditUrl, auditResult);
        assistantContent = isOrchestrated
          ? `${summary}\n\n---\n\nThis is a Boss-owned, end-to-end SEO workflow -- resuming control now to plan and attempt remediation for what was just found.`
          : summary;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The audit could not be completed.";
        assistantContent = `I tried to run a live audit on ${auditUrl} through ADASOS's production pipeline, but it failed: ${reason}`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === CONTENT_PIPELINE_ENTRY_AGENT_ID) {
      try {
        const pipelineResult = await runContentGenerationPipeline(message, decision.rationale);
        assistantContent = pipelineResult.finalReply;
        pipelineTrace = pipelineResult.trace;
        await persistChatGeneratedContentDraft(userId, pipelineResult.content).catch((err) => {
          console.error("[api/workspace/messages] failed to persist chat-generated content draft", err);
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(The automated content pipeline could not complete: ${reason})`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === PROSPECTING_AGENT_ID) {
      // REAL DISPATCH (2026-08-16 routing fix): runProspecting() constructs
      // the real ProspectingAgent, wired to resolveProspectDiscoveryProvider()
      // -- the SAME real-or-Null DataForSEO SERP capability Settings ->
      // Integrations reports (see web/src/server/backend/prospecting.ts's
      // own header). Without this branch, an assignedAgentId of
      // "prospecting-agent" would fall through to the generic, tool-less
      // Claude role-play branch below -- correct routing with no real
      // execution behind it, the exact gap capability-classifier.ts's own
      // "CAPABILITY-REGISTRY VS. REAL EXECUTION" comment documents for
      // every other non-dispatch-wired agent.
      try {
        const prospectingResult = await runProspecting(message);
        assistantContent = summarizeProspectingForChat(prospectingResult);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(The real Prospecting Agent could not complete: ${reason})`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === WEB_DEVELOPMENT_AGENT_ID) {
      // REAL DISPATCH (WEB DEVELOPMENT AGENT GITHUB-ACCESS FIX):
      // planWebDevelopmentChange() reads the actually-connected repository's
      // real files via the SAME GitHubRepositoryAdapter every remediation
      // write already uses, drafts a real, whole-file-aware change, and
      // saves it pending human approval -- never commits within this same
      // request (see web-development.ts's own header on why). The target
      // URL comes from the message if one was given, else the currently
      // connected repository's own real deployed URL -- the same
      // extract-from-message-or-fall-back-to-known-site convention the
      // audit/remediation branches elsewhere in this route already use.
      try {
        const planResult = await planWebDevelopmentChange(userId, message, extractUrl(message) ?? connectedRepositoryLiveUrl);
        assistantContent = summarizeWebDevelopmentPlanForChat(planResult);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(The real Web Development Agent could not complete: ${reason})`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === CAMPAIGN_TRACKING_AGENT_ID) {
      // PHASE 3 LIVE INTEGRATION FIX (2026-08-18): runCampaignTrackingFromMessage()
      // is the real, chat-dispatch-wired execution path -- see
      // campaign-tracking.ts's own header on the gap this closes. Without
      // this branch, an assignedAgentId of "campaign-tracking-agent" only
      // ever got a read-only grounding-context text block appended before
      // falling through to the generic Claude role-play branch below --
      // correct routing with no real create/save execution behind it.
      try {
        const tracked = await runCampaignTrackingFromMessage(userId, message);
        if (tracked) {
          assistantContent = summarizeCampaignTrackingForChat(tracked);
        } else {
          // The message named no real, extractable campaign (e.g. "what's
          // my campaign status?") -- a genuine read-only question, not a
          // create/track request. Falls back to the real, persisted-
          // evidence-grounded reply instead of guessing which campaign the
          // user means.
          const spec = await getSpecialistAgentSpec(decision.assignedAgentId);
          if (spec) {
            const effectiveMessage = `${message}\n\n${await buildCampaignTrackingContext(userId)}`;
            assistantContent = await generateSpecialistReply(spec, effectiveMessage, decision.rationale);
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(The real Campaign Tracking Agent could not complete: ${reason})`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === GRAPHIC_DESIGN_AGENT_ID) {
      // REAL DISPATCH (VISUAL-ASSET ROUTING FIX): runGraphicDesignRequest()
      // fetches real site context (when a URL is available) and calls the
      // SAME real, shared Pixabay service (server/pixabay.ts) every other
      // Pixabay caller in this codebase goes through -- see
      // graphic-design.ts's own header. This never runs the SEO
      // content-generation pipeline and never treats the request text as a
      // target keyword.
      try {
        const graphicDesignResult = await runGraphicDesignRequest(message, extractUrl(message) ?? historicalUrlFallback);
        assistantContent = summarizeGraphicDesignForChat(graphicDesignResult);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(The real Graphic Design Agent could not complete: ${reason})`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === KEYWORD_RESEARCH_AGENT_ID) {
      // REAL DISPATCH (KEYWORD RESEARCH EXECUTION WIRING FIX): researchKeywords() already wires the
      // real, already-tested DataForSeoKeywordDataProvider (see server/backend/keyword-research.ts's
      // own header) -- this never role-plays an answer and never invents search volume, difficulty, or
      // intent. Only ever calls the real provider once a real, specific topic has been deterministically
      // identified in the user's own words (extractKeywordResearchSubject()); otherwise it honestly asks
      // for one instead of guessing a keyword to look up.
      const keywordSubject = extractKeywordResearchSubject(message);
      if (!keywordSubject) {
        // TARGET-VS-KEYWORD FALLBACK (2026-09-03): keyword-research.ts's own VAGUE_KEYWORD_SUBJECT_WORDS
        // fix stops a URL/target-referring phrase ("this target", "the target website", ...) from ever
        // being sent to DataForSEO as a literal search term -- but a null subject here previously fell
        // straight through to the SAME generic "what should I research?" text regardless of whether the
        // user actually named a real target website in this exact message. Only extractUrl(message) (the
        // CURRENT message's own URL -- never historicalUrlFallback/connectedRepositoryLiveUrl/
        // mostRecentAudit) is checked here, purely to make the honest reply acknowledge the real target
        // ADASOS did see, rather than reading as if the URL were never noticed at all. The actual
        // researchKeywords() call below still never receives a URL either way -- this agent has no
        // capability to derive keywords from a domain, so a topic is still genuinely required.
        const mentionedUrl = extractUrl(message);
        // ATTACHMENT-AWARE FALLBACK (2026-09-02): a real, live-observed defect -- this branch used to
        // ask for "a specific topic" even when a real attachment WAS present, which reads as (and was
        // reported as) "no file was ever attached." Keyword Research's real capability is search-
        // volume/difficulty lookup for a named topic, not spreadsheet-content parsing (no parser exists
        // -- see server/backend/attachments.ts's own header), so this honestly discloses the real
        // attachment it did receive instead of silently ignoring it or fabricating support for reading it.
        assistantContent = attachmentMeta
          ? `I can see the attached file (${attachmentMeta.originalFileName}), but ADASOS's Keyword Research integration only looks up real search volume and difficulty for a specific topic, product, or service you name in your message -- it doesn't read the contents of an uploaded ${attachmentMeta.fileType.toUpperCase()} file. Tell me the topic, product, or service to research, or describe what's in the file, and I'll pull real keyword data for it.`
          : mentionedUrl
            ? `I can see you want keyword research for ${mentionedUrl}, but ADASOS's Keyword Research integration looks up real search volume and difficulty for a specific topic, product, or service -- it can't derive keywords from a URL alone. What topic, product, or service should I research for that site -- for example, "keyword opportunities for a local plumbing business" or "target keywords for our new yoga app"?`
            : "I can pull real keyword data (search volume and difficulty) through ADASOS's DataForSEO Keyword " +
              "Research integration, but I need a specific topic, product, or service to research first -- for " +
              'example, "keyword opportunities for a local plumbing business" or "target keywords for our new ' +
              'yoga app." What should I research?';
      } else {
        try {
          const keywordResult = await researchKeywords(message, [keywordSubject]);
          const baseKeywordSummary = summarizeKeywordResearchForChat(keywordSubject, keywordResult);
          assistantContent = attachmentContext ? `${baseKeywordSummary}\n\n${attachmentContext}` : baseKeywordSummary;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "an unknown error";
          assistantContent = `I tried to run real keyword research for "${keywordSubject}" through ADASOS's DataForSEO Keyword Research integration, but it failed: ${reason}`;
        }
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === COMPETITOR_INTELLIGENCE_AGENT_ID) {
      // REAL DISPATCH (COMPETITOR INTELLIGENCE ORCHESTRATION, 2026-09-03): runCompetitorIntelligence()
      // (server/backend/competitor-intelligence.ts) assembles the real Website Audit/Technical SEO/Keyword
      // Research results for the CURRENT target, discovers real organic competitors via DataForSEO Labs,
      // fetches their real HTML, and runs the real, isolated CompetitorIntelligenceAgent -- see that
      // module's own header for the full pipeline. Deliberately never falls back to
      // historicalUrlFallback/connectedRepositoryLiveUrl/mostRecentAudit for the target: only
      // extractUrl(message) (the CURRENT message's own URL) is passed, so a previous task's site can never
      // leak into this analysis. No LLM call anywhere in this branch.
      try {
        const competitorResult = await runCompetitorIntelligence(userId, extractUrl(message), message);
        assistantContent = attachmentContext ? `${competitorResult}\n\n${attachmentContext}` : competitorResult;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `I tried to run real Competitor Intelligence analysis, but it failed: ${reason}`;
      }
    } else if (
      decision?.status === "assigned" &&
      decision.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID &&
      attachmentMeta &&
      SPREADSHEET_FILE_TYPES.has(attachmentMeta.fileType)
    ) {
      // REAL DISPATCH (SPREADSHEET FILE PROCESSING WIRING FIX, 2026-09-02): processSpreadsheetAttachment()
      // retrieves the real, already-uploaded, ownership-checked attachment bytes and parses them entirely
      // locally (spreadsheet-reader.ts) -- never sends file content to any external/AI service, never
      // modifies the original file. Only fires when a real spreadsheet-type attachment is present on THIS
      // message (see tag-weighted-routing-strategy.ts's hasSpreadsheetProcessingIntent() for the routing
      // signal that assigns this agent in the first place) -- a genuine "is my Google Sheet connected?"
      // question with no local attachment falls through to the generic branch below, which still uses
      // google-sheets-integration-agent's own EXISTING real connection-status grounding context, unaffected.
      try {
        const processingResult = await processSpreadsheetAttachment(userId, attachmentMeta);
        assistantContent = processingResult.reply;
        spreadsheetCleaningApproval = processingResult.approvalMeta ?? null;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `I found the attached file "${attachmentMeta.originalFileName}", but reading it failed: ${reason}`;
      }
    } else if (
      decision?.status === "assigned" &&
      decision.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID &&
      !(attachmentMeta && SPREADSHEET_FILE_TYPES.has(attachmentMeta.fileType)) &&
      detectExistingOutputTabSelfCleanupRequest(message)
    ) {
      // REAL DISPATCH (EXISTING-OUTPUT-TAB SELF-CLEANUP, 2026-09-21): a request to de-duplicate ADASOS's
      // OWN already-written output tab (e.g. "Admin - Vendor"/"Client Sheet"), as opposed to cleaning a
      // SOURCE sheet into the configured destination (the branch immediately below, unchanged). Checked
      // FIRST, and mutually exclusive with that branch by construction -- see
      // detectExistingOutputTabSelfCleanupRequest()'s own header (spreadsheet-existing-output-cleanup.ts)
      // for exactly what it requires to match. Read-only: only ever proposes, never writes -- a write only
      // happens later, through the same human-approval gate, once explicitly approved.
      try {
        const targets = detectExistingOutputTabSelfCleanupRequest(message)!;
        const processingResult = await proposeExistingOutputTabCleanupForChat(userId, targets);
        assistantContent = processingResult.reply;
        spreadsheetCleaningApproval = processingResult.approvalMeta ?? null;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `I tried to read the existing output tab to clean it, but it failed: ${reason}`;
      }
    } else if (
      decision?.status === "assigned" &&
      decision.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID &&
      !(attachmentMeta && SPREADSHEET_FILE_TYPES.has(attachmentMeta.fileType)) &&
      looksLikeSpreadsheetOperationRequest(message)
    ) {
      // REAL DISPATCH (LIVE GOOGLE SHEETS CLEANING WIRING, 2026-09-15): processSelectedGoogleSheet()
      // (server/backend/google-sheets-cleaning.ts) reads the user's own already-selected Google Sheet
      // directly through the real, already-connected READ-ONLY Sheets integration (batched, non-truncating
      // -- see getAllSpreadsheetValues()) and runs the SAME deterministic server-side cleaning pipeline the
      // branch above uses for an uploaded file -- entirely locally, no spreadsheet row is ever sent to the
      // LLM. Only fires when NO local spreadsheet-type attachment is present (that case is still handled,
      // unchanged, by the branch immediately above) AND the message is a recognizable spreadsheet-operation
      // request (looksLikeSpreadsheetOperationRequest(), the SAME detector the attachment path already
      // uses) -- these two branches are mutually exclusive by construction. A bare "is my Google Sheet
      // connected?" question with no operation verb still falls through, unaffected, to the generic
      // buildGoogleSheetsContext() branch further below.
      // DOMAIN-LEVEL DEDUP WIRING (2026-09-24): the raw `message` is passed through so
      // processSelectedGoogleSheet() can honor an explicit "one record per domain"/"excluding platform
      // domains" request the SAME way the existing-output-tab branch above already does -- see that
      // function's own header (google-sheets-cleaning.ts) for why this flow needed the same fix.
      try {
        const processingResult = await processSelectedGoogleSheet(userId, message);
        assistantContent = processingResult.reply;
        spreadsheetCleaningApproval = processingResult.approvalMeta ?? null;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `I tried to read your selected Google Sheet to clean it, but it failed: ${reason}`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId) {
      try {
        const spec = await getSpecialistAgentSpec(decision.assignedAgentId);
        if (spec) {
          // The Performance & Analytics Agent's own Rules say "base all
          // conclusions on verified performance data" and "never fabricate
          // or manipulate metrics" -- but nothing ever gave it real data to
          // base anything on. buildSearchConsoleContext() makes a real call
          // to the already-connected Google Search Console integration
          // (server/google-search-console.ts) and appends the true result
          // (real numbers, or a real "not connected"/"not verified"/"no
          // data yet" status) to the message, so the model is grounded
          // either way instead of guessing it has no access at all.
          // STEP 3 WIRING FIX: same grounding-context pattern as the branches
          // above, for the Off-Page SEO Agent's real backlink data
          // (off-page-seo.ts's buildOffPageSeoContext(), which reaches the
          // already-wired, already-tested DataForSeoBacklinkDataProvider via
          // getBacklinkProfile()). The url comes from the same
          // extract-from-message-or-fall-back-to-known-site chain the audit/
          // remediation/workflow branches elsewhere in this route already use.
          //
          // BING WEBMASTER INTEGRATION: buildBingWebmasterContext() is the
          // same real, non-fabricated grounding-context pattern as
          // buildSearchConsoleContext() immediately above, for a genuinely
          // different provider (Microsoft, not Google) -- appended as its
          // own, separately source-labeled block, never merged into Search
          // Console's numbers. Reaches only Performance & Analytics Agent,
          // matching Google Search Console's own current reach exactly
          // (least privilege -- see Agents/performance-analytics-agent.md).
          const baseEffectiveMessage =
            decision.assignedAgentId === PERFORMANCE_ANALYTICS_AGENT_ID
              ? `${message}\n\n${await buildSearchConsoleContext(userId)}\n\n${await buildBingWebmasterContext(userId)}`
              : decision.assignedAgentId === ADMIN_AGENT_ID
                ? `${message}\n\n${await buildGovernanceEvidenceContext(userId)}`
                : decision.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID
                  ? `${message}\n\n${await buildGoogleSheetsContext(userId)}`
                  : decision.assignedAgentId === OFF_PAGE_SEO_AGENT_ID
                    ? `${message}\n\n${await buildOffPageSeoContext(extractUrl(message) ?? historicalUrlFallback)}`
                    : decision.assignedAgentId === ON_PAGE_SEO_AGENT_ID
                      ? `${message}\n\n${await buildSavedAuditEvidenceContext(userId, extractUrl(message) ?? historicalUrlFallback)}`
                      : message;
          // WORKSPACE FILE ATTACHMENT CAPABILITY: appended AFTER any provider-specific grounding block
          // above, for whichever specialist was actually assigned -- the routed agent explicitly learns
          // a real file was attached (name/type/size/id) and that it's a genuine user-supplied input,
          // never something to guess the contents of. Never affects which grounding block above ran.
          const effectiveMessage = attachmentContext ? `${baseEffectiveMessage}\n\n${attachmentContext}` : baseEffectiveMessage;
          assistantContent = await generateSpecialistReply(spec, effectiveMessage, decision.rationale);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(No AI-generated response could be produced: ${reason})`;
      }
    }

    // REAL REMEDIATION EXECUTION LAYER (2026-08-14, broadened 2026-08-15):
    // the one, deliberately narrow remediation type this system ships with
    // -- see src/boss-agent/remediation/*.ts's own headers. Runs
    // ADDITIONALLY to whatever dispatch branch above already produced (a
    // message can both ask to diagnose AND fix in one turn, exactly like the
    // real acceptance scenario this was built for: "...has a missing
    // robots.txt. Please diagnose the problem, fix it, and verify..."), so
    // it is intentionally NOT an `else` branch. `userId` is this app's real
    // workspace/tenant boundary (see the client-isolation requirement this
    // satisfies) -- a remediation task is never created, read, or acted on
    // outside the requesting user's own id.
    //
    // Triggers on either: (a) a real robots.txt/canonical mention plus a
    // real fix-intent verb (the original, narrow literal-keyword trigger --
    // still needed for a short, ad hoc "fix the canonical tag" message with
    // no orchestrated classification), OR (b) `isOrchestrated` (2026-08-15):
    // a Boss-owned workflow (audit_and_remediate / end_to_end_seo /
    // remediation_only / client_production_validation) ALWAYS continues into
    // this real pipeline regardless of the message's exact wording -- "fix
    // every problem ADASOS can actually remediate" never says "robots.txt"
    // or "canonical" by name, but Boss still resumes control and genuinely
    // attempts remediation after the audit stage (or immediately, for
    // remediation_only). runTechnicalSeoRemediation() itself independently,
    // genuinely re-checks both real remediation types and returns `null`
    // when nothing is actually broken -- never fabricates a finding just
    // because this trigger fired. Calling this at most once per turn (this
    // is still the single call site) is what keeps a Boss-owned workflow
    // from ever creating a duplicate remediation task or approval.
    /**
     * Applies a real RemediationTaskView result to the assistant's reply
     * and (for an interactive state) the approval card -- shared by both
     * the fresh-candidate path and the in-flight-resume path below so
     * neither duplicates this logic or drifts out of sync.
     *
     * UI-SURFACING FIX (2026-08-16): the "which finalStatus gets a card,
     * and what does its metadata look like" decision now lives in
     * buildRemediationApprovalCardMeta() (server/backend/remediation.ts) --
     * a single, shared, directly-tested function -- instead of being
     * duplicated inline here.
     */
    async function applyRemediationResult(task: RemediationTaskView): Promise<void> {
      assistantContent = `${assistantContent}\n\n---\n\n${summarizeRemediationForChat(task)}`;
      const cardMeta = await buildRemediationApprovalCardMeta(task);
      if (cardMeta) {
        remediationApproval = cardMeta;
      }
    }

    // IN-FLIGHT VERIFICATION RESUME (2026-08-15, system-consistency pass): a
    // real, confirmed gap -- a chat follow-up like "check again" for a case
    // whose remediation is already approved/executed and only waiting on
    // live deployment propagation must resume THAT exact real approval via
    // the SAME resumeVerificationAction() the UI's own "Check again" button
    // calls (real bounded-retry state transition, real verification
    // evidence, real decidedAt) -- never fall through to fresh candidate
    // selection. runTechnicalSeoRemediation() short-circuits to "nothing to
    // remediate" the instant a live re-check happens to pass, which would
    // silently leave the real approval row stuck at "verification_pending"
    // forever (never transitioned to RESOLVED with real evidence, never
    // updating the real RemediationExecutionRecord) even though the
    // underlying fix is genuinely confirmed working. Workspace-scoped, not
    // finding-scoped -- this app's synchronous, one-shot execution model
    // means at most one approval is genuinely in flight at a time.
    const inFlightApproval = await db.remediationApproval.findFirst({ where: { workspaceId: userId, status: "verification_pending" }, orderBy: { createdAt: "desc" } });

    if (inFlightApproval) {
      try {
        const resumed = await resumeVerificationAction(userId, inFlightApproval.id);
        if (resumed.ok) {
          await applyRemediationResult(resumed.task);
        } else {
          assistantContent = `${assistantContent}\n\n---\n\n(Could not resume the in-progress remediation check: ${resumed.error})`;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${assistantContent}\n\n---\n\n(The in-progress remediation check could not complete: ${reason})`;
      }
    } else if (
      ((ROBOTS_TXT_MENTION_PATTERN.test(message) || CANONICAL_MENTION_PATTERN.test(message)) && FIX_INTENT_PATTERN.test(message)) ||
      isOrchestrated ||
      // DIRECT TECHNICAL-SEO-AGENT FIX-EXECUTION GAP (2026-09-11): a real,
      // confirmed gap -- a request DIRECTLY assigned to technical-seo-agent
      // or website-audit-agent (decision.status === "assigned", never
      // isOrchestrated) that asked to fix/repair/resolve/correct a problem
      // stopped after the auditUrl branch above showed the saved/fresh
      // audit, because this trigger previously required either full Boss
      // orchestration OR the message literally naming "robots.txt"/
      // "canonical" -- but the actual remediable finding type is determined
      // FROM the real audit evidence by runRemediationFromAuditFindings()
      // below, never from which word the user happened to use. A message
      // like "diagnose and fix the technical SEO issues on
      // https://example.com" (no literal "robots.txt"/"canonical" mention)
      // directly assigned to technical-seo-agent now reaches this same,
      // unchanged remediation pipeline instead of silently stopping after
      // the audit summary. Deliberately does NOT broaden this to every
      // agent/intent -- only a genuine fix-intent verb (the SAME
      // FIX_INTENT_PATTERN this trigger already uses elsewhere) on a
      // request actually assigned to one of the two agents that own this
      // real remediation capability.
      (decision?.status === "assigned" &&
        (decision.assignedAgentId === TECHNICAL_SEO_AGENT_ID || decision.assignedAgentId === WEBSITE_AUDIT_AGENT_ID) &&
        FIX_INTENT_PATTERN.test(message))
    ) {
      // REAL REMEDIATION EXECUTION LAYER (2026-08-14, broadened 2026-08-15):
      // the one, deliberately narrow remediation type this system ships
      // with -- see src/boss-agent/remediation/*.ts's own headers. Runs
      // ADDITIONALLY to whatever dispatch branch above already produced (a
      // message can both ask to diagnose AND fix in one turn, exactly like
      // the real acceptance scenario this was built for: "...has a missing
      // robots.txt. Please diagnose the problem, fix it, and verify..."),
      // so it is intentionally NOT an `else` branch off the specialist
      // dispatch above -- it IS, however, mutually exclusive with the
      // in-flight-resume branch above (never both in the same turn; see
      // that branch's own comment on why). `userId` is this app's real
      // workspace/tenant boundary -- a remediation task is never created,
      // read, or acted on outside the requesting user's own id.
      //
      // Triggers on either: (a) a real robots.txt/canonical mention plus a
      // real fix-intent verb (the original, narrow literal-keyword trigger
      // -- still needed for a short, ad hoc "fix the canonical tag" message
      // with no orchestrated classification), OR (b) `isOrchestrated`
      // (2026-08-15): a Boss-owned workflow (audit_and_remediate /
      // end_to_end_seo / remediation_only / client_production_validation)
      // ALWAYS continues into this real pipeline regardless of the
      // message's exact wording -- "fix every problem ADASOS can actually
      // remediate" never says "robots.txt" or "canonical" by name, but Boss
      // still resumes control and genuinely attempts remediation after the
      // audit stage (or immediately, for remediation_only).
      // runTechnicalSeoRemediation() itself independently, genuinely
      // re-checks both real remediation types and returns `null` when
      // nothing is actually broken -- never fabricates a finding just
      // because this trigger fired. Calling this at most once per turn
      // (this is still the single call site) is what keeps a Boss-owned
      // workflow from ever creating a duplicate remediation task or
      // approval.
      const remediationUrl = auditUrl ?? extractUrl(message) ?? historicalUrlFallback;

      if (remediationUrl) {
        try {
          // DOCTOR FLOW COMPLETION (2026-08-21): prefers this SAME turn's
          // fresh auditResult, falling back to the real, persisted SeoAudit
          // row for this exact URL -- the identical convention the
          // continuation block below already used for the content pipeline
          // and reporting stages (see that block's own "EVIDENCE HANDOFF
          // FIX" comment), just computed once here and shared rather than
          // duplicated. When real findings exist in either place, remediation
          // is driven by them (never re-derives or discards them via an
          // independent live re-check); only when NO audit has ever been run
          // for this URL does the narrow, ad hoc runTechnicalSeoRemediation()
          // live-check path apply (unchanged, existing behavior for a bare
          // "fix the canonical tag" message with no prior audit).
          findingsResultForWorkflow = auditResult;
          if (!findingsResultForWorkflow) {
            const persistedAudit = await db.seoAudit.findFirst({ where: { userId, url: remediationUrl }, orderBy: { createdAt: "desc" }, select: { resultJson: true } });
            if (persistedAudit) {
              try {
                findingsResultForWorkflow = JSON.parse(persistedAudit.resultJson) as FullAuditResult;
              } catch {
                findingsResultForWorkflow = null;
              }
            }
          }

          if (findingsResultForWorkflow) {
            const auditDriven = await runRemediationFromAuditFindings(
              userId,
              remediationUrl,
              findingsResultForWorkflow.websiteAudit.findings,
              { robotsTxtFound: findingsResultForWorkflow.crawl.robotsTxtFound, sitemapUrlsFound: findingsResultForWorkflow.crawl.sitemapUrlsFound, crawledUrls: findingsResultForWorkflow.crawl.crawledUrls },
            );
            prioritizedFindingsForDoctorFlow = auditDriven.prioritizedFindings;
            unsupportedFindingsForDoctorFlow = auditDriven.unsupportedFindings;
            remediationTask = auditDriven.task;
            if (remediationTask) {
              await applyRemediationResult(remediationTask);
            } else if (isOrchestrated) {
              const unsupportedNote = unsupportedFindingsForDoctorFlow.length > 0 ? ` ${unsupportedFindingsForDoctorFlow.length} finding(s) have no automated remediation and are reported separately.` : "";
              assistantContent = `${assistantContent}\n\n---\n\nRemediation check complete: every real, supported finding from the audit already passes at ${remediationUrl} -- nothing for ADASOS to remediate right now.${unsupportedNote}`;
            }
          } else {
            remediationTask = await runTechnicalSeoRemediation(userId, remediationUrl);
            if (remediationTask) {
              await applyRemediationResult(remediationTask);
            } else if (isOrchestrated) {
              // Boss genuinely re-checked both real remediation types and
              // found nothing wrong -- an honest, explicit "nothing to fix"
              // completes the workflow instead of silently stopping after the
              // audit stage (which would leave the audit summary looking like
              // the terminal answer).
              assistantContent = `${assistantContent}\n\n---\n\nRemediation check complete: both real, supported checks (robots.txt, homepage canonical tag) already pass at ${remediationUrl} -- nothing for ADASOS to remediate right now.`;
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "an unknown error";
          assistantContent = `${assistantContent}\n\n---\n\n(The robots.txt remediation check could not complete: ${reason})`;
        }

        // FIX 2 -- RE-AUDIT + VERIFY FOR A DIRECTLY-EXECUTED FIX (2026-09-11):
        // a directly-assigned technical-seo-agent/website-audit-agent request
        // (e.g. a bare "fix the canonical tag" message, never Boss-
        // orchestrated) reaches a genuine execution attempt above via the
        // SAME real RemediationOrchestrator execution path the orchestrated
        // flow already uses (applyRemediationResult ->
        // runRemediationFromAuditFindings / runTechnicalSeoRemediation), but
        // previously received no re-audit/before-vs-after verification of
        // its own -- only the isOrchestrated Doctor Flow block below
        // (existing, unchanged) got one, so a directly-assigned request could
        // never complete ACCESS EVIDENCE -> FIX -> RE-AUDIT -> VERIFY.
        // Reuses doctor-flow.ts's own real, already-tested
        // runFullReAudit()/compareAudits() -- the exact same safe
        // runFullAudit() call path every other re-audit in this file already
        // uses, never a new/independent crawl mechanism, and never touches
        // remediation.ts/RemediationOrchestrator (so this has zero effect on
        // remediation.test.ts's own invalid-token, no-live-call guarantee).
        // findingsResultForWorkflow is this exact turn's own real "before"
        // evidence (the same fresh/persisted audit remediation was just
        // driven from, above) -- never a second, independently-resolved
        // "before" lookup. Gated on `!isOrchestrated` (the orchestrated case
        // already gets its own, more complete Doctor Flow report later in
        // this turn -- this avoids a second, redundant live re-audit for the
        // same fix) and `taskReachedExecutionAttempt` (only
        // resolved/failed/failed_with_rollback/rollback_failed genuinely
        // attempted a real write -- a still-pending approval or a rejection
        // never triggers a re-audit, since nothing could have changed).
        // Never reports FIXED without this real comparison proving it --
        // see deriveFixVerdict()'s own doc comment.
        if (!isOrchestrated && findingsResultForWorkflow && taskReachedExecutionAttempt(remediationTask)) {
          try {
            const postFixAudit = await runFullReAudit(remediationUrl);
            const comparison = compareAudits(findingsResultForWorkflow, postFixAudit);
            assistantContent = `${assistantContent}\n\n---\n\n${summarizeReAuditVerificationForChat(remediationUrl, comparison)}`;
          } catch (error) {
            const reason = error instanceof Error ? error.message : "an unknown error";
            assistantContent = `${assistantContent}\n\n---\n\n(The post-fix re-audit/verification could not complete: ${reason})`;
          }
        }
      } else if (isOrchestrated) {
        // Honest, not fabricated: never claim a remediation stage ran
        // without a real URL to run it against.
        assistantContent = `${assistantContent}\n\n---\n\nI need a URL to run the remediation stage of this workflow -- please share the site's URL and I'll continue from there.`;
      }
    }

    // PHASE 5 WORKFLOW CONTINUATION FIX (2026-08-18): real, live-reproduced
    // defect -- a Boss-owned orchestrated workflow (audit_and_remediate /
    // end_to_end_seo / remediation_only / client_production_validation)
    // correctly ran the audit stage, then correctly resumed control and ran
    // the remediation stage, then the turn simply ended -- no code path
    // anywhere continued into Strategy / Keyword Research / Content /
    // On-Page SEO, even though that exact pipeline already exists and
    // already works (specialist-orchestrator.ts's runContentGenerationPipeline,
    // otherwise only reachable when "seo-content-agent" is individually
    // assigned as a specialist -- which an "orchestrated" decision, having
    // no assignedAgentId, can never be). This was a genuine orchestration
    // gap, not an intentional boundary: task-intent-classifier.ts's own
    // header explicitly documents "strategy" as one of the stages an
    // end-to-end request combines, and the required workflow this fixes for
    // is Audit -> Strategy -> Keyword Research -> Content -> On-Page SEO ->
    // Campaign -> Reporting.
    //
    // Reuses the EXACT same "always continue in isOrchestrated" precedent
    // already established one stage earlier (audit -> remediation, above) --
    // no new architecture, no new agent dispatch, the same real
    // runContentGenerationPipeline() the SEO Content Agent's own direct
    // assignment already uses.
    //
    // GATED on `!remediationApproval` (2026-08-18): the one thing this fix
    // must never do is bypass the real, existing human-approval gate --
    // buildRemediationApprovalCardMeta() only ever returns non-null for a
    // genuinely awaiting-decision or in-progress state (pending_approval,
    // verification_pending, root_site_provisioning_required -- see its own
    // header; every terminal state, including "nothing to fix", leaves this
    // null). So the workflow advances to the next stage exactly when
    // remediation reached a real terminal outcome, and correctly PAUSES
    // (never fabricating a completed decision) whenever a human still needs
    // to act. Also requires a resolved site URL (auditUrl, or the same
    // real fallback chain the remediation trigger above already uses) --
    // Boss never claims to continue a workflow it has no real site context
    // for.
    if (isOrchestrated && !remediationApproval) {
      const workflowUrl = auditUrl ?? extractUrl(message) ?? historicalUrlFallback;
      if (workflowUrl) {
        try {
          // EVIDENCE HANDOFF FIX (2026-08-18): real, live-reproduced gap --
          // the continuation above passed the raw chat message alone into
          // runContentGenerationPipeline(), never this same workflow's own
          // real audit findings (crawl/Lighthouse/header results already
          // computed either earlier in THIS turn, or in a prior turn for a
          // "remediation_only" follow-up that resumes the same case). Every
          // downstream specialist correctly (per its own anti-fabrication
          // rules) declined to invent site-specific keywords/strategy/
          // content/on-page recommendations without real findings to ground
          // them in -- confirmed live. This is not a new context mechanism:
          // it reuses summarizeAuditForChat()'s own real, deterministic
          // (no-LLM) findings summary -- the exact same text already shown
          // to the user for the audit stage -- as the SAME kind of
          // bracketed, real-evidence grounding block this file's other
          // build*Context() helpers already append before a specialist
          // reply (buildSearchConsoleContext, buildGovernanceEvidenceContext,
          // etc.), just prepended to the content pipeline's own userMessage
          // input instead of a single specialist's. No change to
          // specialist-orchestrator.ts itself -- the direct seo-content-agent
          // assignment path is unaffected.
          //
          // Prefers this turn's own fresh auditResult; falls back to the
          // real, persisted SeoAudit row for the same resolved URL (chat-
          // triggered audits are already saved for exactly this kind of
          // reopening -- see the comment below), scoped to this workspace's
          // own userId -- the same tenant-isolation boundary every other
          // lookup in this file already uses. Never fabricates findings:
          // if no real audit result exists in either place, the pipeline
          // still runs (unchanged behavior), just without findings to
          // ground it in.
          // DOCTOR FLOW COMPLETION (2026-08-21): reuses findingsResultForWorkflow
          // -- computed once, above, at the remediation trigger (same
          // workflowUrl/remediationUrl formula) -- instead of duplicating this
          // exact lookup a second time; only re-derives it here if that
          // earlier computation genuinely never ran (e.g. isOrchestrated with
          // no remediationUrl resolved at that point).
          let findingsResult: FullAuditResult | null = findingsResultForWorkflow ?? auditResult;
          if (!findingsResult) {
            const persistedAudit = await db.seoAudit.findFirst({ where: { userId, url: workflowUrl }, orderBy: { createdAt: "desc" }, select: { resultJson: true } });
            if (persistedAudit) {
              try {
                findingsResult = JSON.parse(persistedAudit.resultJson) as FullAuditResult;
              } catch {
                findingsResult = null;
              }
            }
          }
          findingsResultForWorkflow = findingsResult;

          // ROUTING/CONTEXT-HANDOFF FIX (2026-08-21): a "remediation_only"
          // orchestrated task is an EXPLICITLY SCOPED Doctor Flow request --
          // task-intent-classifier.ts only reaches this intent when the
          // message describes a remediation/execution/deployment action
          // with no separate audit-workflow stage of its own (see its own
          // header). The three stages below (Content Pipeline, Campaign
          // Tracking, Client SEO-Performance Reporting) are the OTHER
          // orchestrated intents' (end_to_end_seo/audit_and_remediate/
          // client_production_validation) real next stages -- continuing
          // into them regardless of taskIntent was a real, live-reproduced
          // defect: a long, multi-sentence remediation-only instruction
          // (e.g. "Run one real live Doctor Flow test focused only on the
          // sitemap issue... Report only: current evidence -> change made ->
          // live re-check result.") was passed whole into
          // runContentGenerationPipeline(), which treats its userMessage
          // argument as the content/keyword topic (see content.ts's
          // researchKeywordsAndGenerateContentFromMessage() and its
          // `seedKeywords: [userMessage]` convention) -- so the entire
          // remediation instruction was classified as a "keyword." Skipping
          // these three stages for "remediation_only" keeps a focused
          // Doctor Flow request inside the Doctor Flow lifecycle; every
          // other orchestrated intent is completely unaffected. The Doctor
          // Flow re-audit/comparison stage below is UNCHANGED and still runs
          // for "remediation_only" -- that IS the real next stage this
          // intent asks for.
          if (decision?.taskIntent !== "remediation_only") {
            const contentPipelineMessage = findingsResult ? `${message}\n\n${buildAuditFindingsContext(workflowUrl, findingsResult)}` : message;

            const nextStage = await runContentGenerationPipeline(contentPipelineMessage, decision?.rationale ?? "");
            assistantContent = `${assistantContent}\n\n---\n\nContinuing the end-to-end workflow into strategy, keyword research, content, and on-page SEO:\n\n${nextStage.finalReply}`;
            pipelineTrace = nextStage.trace;
            await persistChatGeneratedContentDraft(userId, nextStage.content).catch((err) => {
              console.error("[api/workspace/messages] failed to persist chat-generated content draft", err);
            });

            // PHASE 5 CAMPAIGN TRACKING FIX (2026-08-19): reuses the exact
            // real Phase 3 persistence dispatch (runCampaignTrackingFromMessage)
            // -- never a second implementation. Campaign Tracking Agent's own
            // real domain is outreach-campaign progress, not generic SEO
            // auditing (see Agents/campaign-tracking-agent.md), so this only
            // runs -- and this stage is only mentioned in the reply -- when
            // the user's own message legitimately names a specific campaign
            // (runCampaignTrackingFromMessage's own extractCampaignName()
            // heuristic, the SAME one already used for direct chat dispatch to
            // this agent). Never invents a campaign name just to exercise this
            // stage: when none is present, this silently produces nothing,
            // matching this block's own established "skip when the real
            // signal isn't there" convention (see the workflowUrl gate above).
            try {
              const campaignTrackingResult = await runCampaignTrackingFromMessage(userId, message);
              if (campaignTrackingResult) {
                assistantContent = `${assistantContent}\n\n---\n\n${summarizeCampaignTrackingForChat(campaignTrackingResult)}`;
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : "an unknown error";
              assistantContent = `${assistantContent}\n\n---\n\n(The campaign tracking stage could not complete: ${reason})`;
            }

            // PHASE 5 CLIENT REPORTING FIX (2026-08-19): the real backend
            // (server/backend/reporting.ts's generateReportFromWorkflowResult(),
            // the real frozen ClientReportingAgent, the existing Report Prisma
            // model) already existed but was never wired into chat/Phase 5 --
            // see reporting.ts's own header. Reuses this SAME turn's already-
            // computed real audit result (findingsResult, above) rather than
            // re-auditing a second time -- "pass the real outputs from the
            // completed workflow into Reporting." clientName/reportingPeriodLabel
            // are real, on-file/derived values (this account's own name or
            // company, and the real current month) -- never fabricated
            // business information. Persisted via the SAME real Report model
            // and userId-scoped convention every other report-generating route
            // (api/reports/seo-performance/route.ts) already uses.
            if (findingsResult) {
              try {
                const account = await db.user.findUnique({ where: { id: userId }, select: { name: true, companyName: true } });
                const clientName = account?.companyName?.trim() || account?.name?.trim() || "Client";
                const reportingPeriodLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
                const report = await generateReportFromWorkflowResult({ clientName, reportingPeriodLabel, url: workflowUrl, auditResult: findingsResult });
                const savedReport = await db.report.create({
                  data: { userId, title: `${clientName} — ${reportingPeriodLabel}`, type: "seo-performance", resultJson: JSON.stringify(report) },
                });
                reportId = savedReport.id;
                assistantContent = `${assistantContent}\n\n---\n\n${summarizeReportForChat(report)}`;
              } catch (error) {
                const reason = error instanceof Error ? error.message : "an unknown error";
                assistantContent = `${assistantContent}\n\n---\n\n(The client reporting stage could not complete: ${reason})`;
              }
            }
          }

          // DOCTOR FLOW COMPLETION (2026-08-21): purely additive -- never
          // replaces or alters the Content Pipeline / Campaign Tracking /
          // Client Reporting stages above. Only ever runs a real, full
          // second audit (never a narrow single-resource check standing in
          // for one) when remediationTask genuinely reached a real EXECUTION
          // ATTEMPT this turn (approved and actually run against the real
          // repository) -- a still-pending approval, a rejection, or a
          // blocked/not-remediable outcome never triggers a re-audit, since
          // nothing could have changed. See doctor-flow.ts's own header.
          if (findingsResult && taskReachedExecutionAttempt(remediationTask)) {
            try {
              const doctorFlowReport = await buildDoctorFlowReport(workflowUrl, findingsResult, prioritizedFindingsForDoctorFlow, unsupportedFindingsForDoctorFlow, remediationTask);
              assistantContent = `${assistantContent}\n\n---\n\n${summarizeDoctorFlowForChat(doctorFlowReport)}`;
              await db.report.create({
                data: { userId, title: `Doctor Flow — ${workflowUrl}`, type: "doctor-flow", resultJson: JSON.stringify(doctorFlowReport) },
              });
            } catch (error) {
              const reason = error instanceof Error ? error.message : "an unknown error";
              assistantContent = `${assistantContent}\n\n---\n\n(The post-remediation re-audit/comparison could not complete: ${reason})`;
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "an unknown error";
          assistantContent = `${assistantContent}\n\n---\n\n(The next workflow stage -- SEO strategy and content -- could not complete: ${reason})`;
        }
      }
    }

    // A chat-triggered audit is a first-class audit -- record it exactly
    // like one run from the SEO Audit page so it shows up in the same
    // history/dashboard, and so the same real evidence can be reopened.
    let seoAuditId: string | null = null;
    if (auditResult) {
      const { summary } = auditResult.websiteAudit;
      const saved = await db.seoAudit.create({
        data: {
          userId,
          url: auditUrl!,
          resultJson: JSON.stringify(auditResult),
          criticalCount: summary.criticalCount,
          warningCount: summary.warningCount,
          infoCount: summary.infoCount,
        },
      });
      seoAuditId = saved.id;
    }

    const assistantMessage = await db.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        content: assistantContent,
        agentId: decision?.assignedAgentId ?? null,
        status: decision?.status ?? null,
        metaJson: JSON.stringify({ routingDecision: decision, escalations, seoAuditId, pipelineTrace, remediationApproval, spreadsheetCleaningApproval, reportId }),
      },
    });

    await db.chatSession.update({ where: { id: chatSession.id }, data: { updatedAt: new Date() } });

    await logActivity(
      userId,
      "workspace",
      auditResult
        ? `Ran a live website audit on ${auditUrl} from the AI Workspace`
        : decision?.status === "assigned"
          ? `Routed a task to ${decision.assignedAgentId}`
          : decision?.status === "escalated"
            ? "A workspace task was escalated for review"
            : "Sent a message in the AI Workspace",
    );

    return NextResponse.json({
      sessionId: chatSession.id,
      sessionTitle: chatSession.title,
      userMessage,
      assistantMessage,
      conversation: response,
      escalations,
    });
  } catch (error) {
    // Defense in depth: whatever goes wrong above, the frontend must always
    // get back parseable JSON instead of an empty/opaque error response.
    console.error("[api/workspace/messages] unhandled error", error);
    const reason = error instanceof Error ? error.message : "The AI Workspace could not process that message.";
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
