# Workflow Configuration

Audience: admin / developer. Covers the real, multi-step automated sequences in the system and how to configure them. See `technical/WORKFLOW_ARCHITECTURE.md` for the architectural explanation and `technical/workflows/*.md` for each workflow's full step-by-step documentation.

## The five documented workflows

| Workflow | Classification | Configuration file(s) | Documentation |
|---|---|---|---|
| SEO Audit Workflow | AUTOMATIC | `src/workflows/seo-audit-workflow.ts` | `technical/workflows/SEO_AUDIT_WORKFLOW.md` |
| Content Generation Pipeline (5-stage) | AUTOMATIC, with role-play stages | `web/src/server/backend/specialist-orchestrator.ts` | `technical/workflows/CONTENT_GENERATION_WORKFLOW.md` |
| Audit Remediation Workflow | HUMAN APPROVAL REQUIRED | `web/src/server/backend/remediation.ts` | `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md` |
| Guest Posting & Outreach Pipeline | RECOMMENDATION ONLY (not automated end-to-end) | Individual agents, not a single orchestrator | `technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md` |
| Reporting Workflow | AUTOMATIC (real) | `web/src/server/backend/reporting.ts` | `technical/workflows/REPORTING_WORKFLOW.md` |

## Configuring the SEO Audit Workflow

Edit step logic/order directly in `src/workflows/seo-audit-workflow.ts`. Keep `technical/workflows/SEO_AUDIT_WORKFLOW.md`'s step table in sync — it documents why real execution order can differ from a nominal step numbering. The optional Lighthouse-based performance step is opt-in (`includePerformanceAudit: true`) and separate from the always-on crawl/technical checks. Requires a root rebuild (`npm run build`) to take effect.

## Configuring the Content Generation Pipeline

Edit `runContentGenerationPipeline()` in `web/src/server/backend/specialist-orchestrator.ts` to change:
- Stage order (currently: Keyword Research → SEO Strategy → SEO Content → On-Page SEO → optional Guest Posting).
- Which stages call a real agent class (Stages 1 and 3 are real; Stages 2, 4, and 5 are role-play/context-fed as of this pass — see `agents/INDEX.md`).
- The `needsGuestPostingStage()` trigger regex that decides whether Stage 5 runs at all.

Requires a web app rebuild/restart. Test by sending a content-generation request with and without guest-posting language and inspecting the resulting `PipelineStepTrace[]`.

## Configuring the Audit Remediation Workflow

This is the most sensitive workflow in the system — see `admin/SECURITY_AND_GOVERNANCE.md` before changing anything here. The real, hard-scoped operation set is defined in `web/src/server/github.ts`'s `REMEDIATION_OPERATIONS` map and is limited to exactly three operations: replacing `robots.txt`, replacing `sitemap.xml`, and setting the canonical link in `index.html`. Anything outside this set is rejected as `NOT_REMEDIABLE`. Widening this scope is a deliberate, security-relevant decision that should not be made casually — see `admin/MASTER_CHANGE_MAP.md`'s Workflows group.

## Configuring the Guest Posting & Outreach pipeline

As of this pass, this pipeline is not automated end-to-end — Prospecting Agent and, separately, Campaign Tracking Agent have confirmed real chat-dispatch execution; the other agents in the conceptual pipeline (Publisher Qualification, Contact Intelligence, Outreach, Reply & Negotiation, Guest Posting & Digital PR) are role-play only and are not automatically chained together. To automate a hand-off between two agents in this pipeline, build a bridge that passes one agent's real, structured output as typed input to the next, following the `WorkflowContext` pattern described in the agent-communication protocol (see `technical/AGENT_COMMUNICATION.md`), then add the corresponding chat-dispatch branch(es). Until that exists, treat each agent in this pipeline as independently reachable, not as stages of one automatic flow.

## Configuring the Reporting Workflow

`web/src/server/backend/reporting.ts` (`generateSeoPerformanceReport`, `generateReportFromWorkflowResult`) assembles a report using the real `WebsiteAuditAgent`, `TechnicalSeoAgent`, `PerformanceAnalyticsAgent`, and `ClientReportingAgent` classes from the compiled `dist/src/agents/` output. Edit report-assembly logic here. The dedicated Reports feature (`web/src/app/api/reports/**`) calls this module directly and does not go through Boss Agent chat routing at all — this is documented per-agent (see `agents/client-reporting-agent.md`) as one of the clearest examples of the same agent identity having two different execution realities depending on how it's reached.

## Adding an entirely new workflow

Build on `src/core/workflow/workflow-engine.ts` and the `WorkflowStep`/`WorkflowContext` types (see `technical/AGENT_COMMUNICATION.md` for the contract: real typed agent results are passed forward via a shared context, never a message bus). Put the new file under `src/workflows/<new-workflow>.ts`, document it under `technical/workflows/`, and — if it should be reachable from the product — add a route under `web/src/app/api/` and/or a chat dispatch branch. If it performs a production-affecting action, it must get a human-approval gate before it ships (see `admin/SECURITY_AND_GOVERNANCE.md`). Add a test under `tests/` mirroring existing workflow tests.

## Where to modify

See the file paths in each section above, and `admin/MASTER_CHANGE_MAP.md`'s "Workflows and content pipeline" group for the exact testing/deployment/approval requirements per change.
