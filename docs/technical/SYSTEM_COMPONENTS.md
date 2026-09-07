# System Components

Audience: developer/engineer. A component-level inventory complementing `ARCHITECTURE.md`'s layer diagram.

## Root backend (`adasos-boss-agent`, package root)

| Component | Location | Responsibility |
|---|---|---|
| `BossAgent` facade | `src/boss-agent/boss-agent.ts` | Produces a `RoutingDecision` only — never executes a specialist. |
| `BossOrchestrator` | `src/boss-agent/boss-orchestrator.ts` | `start()`/`stop()` lifecycle shell around `BossAgent`; adds its own lifecycle audit events. |
| `AgentRegistry` | `src/boss-agent/registry/agent-registry.ts` | Loads `Agents/*.md` specs from disk into routable candidates. |
| `TagWeightedRoutingStrategy` | `src/boss-agent/routing/tag-weighted-routing-strategy.ts` | Keyword/IDF-weighted scoring, blended with spec `Tags`/`Capabilities`. |
| `TaskRouter` | `src/boss-agent/routing/task-router.ts` | Applies thresholds, produces auto-assign or escalation decisions. |
| `RoutingRejectionTracker` | `src/boss-agent/routing/routing-rejection-tracker.ts` | Durable (survives restart) tracking of prior routing rejections. |
| `ComplianceValidator` | `src/boss-agent/governance/compliance-validator.ts` | Validates a `RoutingDecision` against registry/governance rules. |
| `EscalationHandler` | `src/boss-agent/governance/escalation-handler.ts` | Resolves an escalation via the configured `ApprovalChannel`. |
| `AuditLogger` | `src/core/governance/audit-logger.ts` | Structured JSONL audit trail, written under `var/`. |
| `TaskStateStore` | `src/boss-agent/state/task-state-store.ts` | Persists each routing run's outcomes. |
| `BossAgentConfig` | `src/boss-agent/config/boss-agent.config.ts` | Central config: agent/state/audit-log directories, `autoAssignThreshold` (default 0.5), `tieMargin` (default 0.1), `maxCandidates` (default 5) — each overridable via `BOSS_AGENT_*` env vars. |
| Root workflows | `src/workflows/*.ts` | Multi-step orchestration scripts (e.g. `seo-audit-workflow.ts`, 23 steps). |
| Root remediation orchestrator | `src/boss-agent/remediation/remediation-orchestrator.ts` | Root-layer half of the technical remediation lifecycle. |
| Specialist agent classes | `src/agents/<id>/` (27 folders) | Per-agent root implementation; not all are used by the real web capability (see `AGENT_ARCHITECTURE.md`). |

## Web application (`adasos-web`, `web/`)

| Component | Location | Responsibility |
|---|---|---|
| Chat dispatch route | `web/src/app/api/workspace/messages/route.ts` | Defines `*_AGENT_ID` constants and real-execution branches; the definitive source for real-vs-role-play classification. |
| Boss Agent web adapter | `web/src/server/backend/boss-agent.ts` | Dynamically imports compiled root `dist/` classes; injects `WebApprovalChannel`. |
| Conversation Language Manager adapter | `web/src/server/backend/conversation.ts` | Language detection/intent classification/prompt-injection escalation ahead of routing. |
| Specialist LLM layer | `web/src/server/backend/specialist-ai.ts` | `generateSpecialistReply()` — the role-play/context-fed reply generator. |
| Content pipeline orchestrator | `web/src/server/backend/specialist-orchestrator.ts` | 5-stage automatic content-generation pipeline. |
| Real content generation | `web/src/server/backend/content.ts` | Real keyword research + SEO content generation. |
| Real website audit | `web/src/server/backend/website-audit.ts` | `runFullAudit()` — real crawl/Lighthouse pipeline, used by both chat dispatch and `/api/seo-audit`. |
| Technical remediation | `web/src/server/backend/remediation.ts`, `remediation-actions.ts` | DIAGNOSE→PLAN→APPROVAL→EXECUTE→DEPLOY→VERIFY→RESOLVED lifecycle. |
| GitHub repository adapter | `web/src/server/github.ts` | Real, least-privilege repository write adapter; `REMEDIATION_OPERATIONS` map. |
| Web development pipeline | `web/src/server/backend/web-development.ts` | Real, whole-file-aware plan→draft→approve→apply pipeline. |
| Approval channel | `web/src/server/backend/approval.ts` | `WebApprovalChannel` — the non-interactive `ApprovalChannel` implementation; never-auto-resolve reasons. |
| Follow-up routing | `web/src/server/backend/follow-up-routing.ts` | Continuity heuristics across chat turns. |
| Governance evidence | `web/src/server/backend/admin-governance.ts` | Real, self-scoped RBAC/audit/isolation evidence for Admin Agent. |
| System readiness checks | `web/src/server/backend/system-readiness.ts` | Six real, read-only production-readiness checks. |
| Integration health checks | `web/src/server/backend/integration-health-check.ts` | Direct, real calls to each integration's own client module. |
| Auth | `web/src/server/auth.ts` | NextAuth config; production `NEXTAUTH_SECRET` hardening. |
| RBAC | `web/src/server/rbac.ts` | Roles, capabilities, `assertAuthorized()`. |
| Rate limiting | `web/src/server/rate-limit.ts` | In-memory, single-instance login/audit rate limiting. |
| Credential encryption | `web/src/server/credential-encryption.ts` | AES-256-GCM `encryptSecret()`/`decryptSecret()`. |
| Database client | `web/src/server/db.ts` | Prisma client singleton; SQLite WAL/busy-timeout pragmas. |
| Integration clients | `web/src/server/{github,wordpress,wordpress-com-oauth,google-oauth,google-search-console,google-analytics,google-drive,google-business-profile,google-sheets,gmail,bing-webmaster,dataforseo,pagespeed,pixabay,pexels,gemini}.ts` | One module per external service — real HTTP calls, response normalization, error handling. |
| Prisma schema | `web/prisma/schema.prisma` | 26 models — see `DATABASE_REFERENCE.md`. |

## Where to modify

Any component change follows the general rule in `ARCHITECTURE.md` §1: root-layer changes require a rebuild; `web/` changes are picked up directly. See `admin/MASTER_CHANGE_MAP.md` for task-specific guidance.
