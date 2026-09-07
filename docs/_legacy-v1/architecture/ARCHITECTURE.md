# System Architecture

Audience: system owner / admin / developer. This document describes the verified, current architecture of ADASOS (Ascent Digital AI SEO Operating System) / "SM Digital" as it actually exists in the codebase — not an aspirational design.

## 1. Two-codebase structure

The repository contains two distinct, differently-purposed codebases that share one Git repo but run as separate systems:

**A. Root backend** (`src/`, `Agents/*.md`, compiled to `dist/`) — a frozen, deterministic Boss Agent orchestration and routing engine.
- Package name: `adasos-boss-agent` (see root `package.json`).
- Deterministic: routing is keyword/IDF-weighted scoring (`TagWeightedRoutingStrategy`), never an LLM call.
- Its own `README.md` explicitly scopes it: "No specialist agent is executed... never a specialist agent logic or module is implemented here" — this describes only this root module's original milestone, not the whole product (see `DOCUMENTATION_CONFLICTS.md`).
- Compiled with TypeScript to `dist/`; the web app dynamically imports the compiled output, never `src/` directly.

**B. `web/`** — the actual running product: a Next.js 15 / React 19 application. This is what a real user (client) interacts with. It:
- Imports the compiled root backend via `import(/* webpackIgnore: true */ \`file://${target}\`)` against `dist/src/...` output (confirmed in `web/src/server/backend/boss-agent.ts`).
- Adds its own persistence (Prisma/SQLite), auth (NextAuth), real integrations (GitHub, WordPress, Google services, Bing), and — critically — the LLM layer (Anthropic Claude) that the root backend does not have.
- Is versioned independently (`web/package.json`, v2.0.0).

**Practical consequence for anyone maintaining this system:** editing a file under `src/` (root) changes the deterministic routing engine and requires a rebuild (`dist/`) before the web app picks it up. Editing a file under `web/src/` changes the actual live product behavior directly (subject to the Next.js build/deploy cycle). See `admin/MASTER_CHANGE_MAP.md` for the exact "where do I change X" table.

## 2. Request-flow layers (chat path — the primary product surface)

```
User message (web UI)
   -> web/src/app/api/workspace/messages/route.ts   (API route, session-scoped)
      -> Conversation Language Manager (CLM)         (web/src/server/backend/conversation.ts)
         - language detection / intent classification / prompt-injection escalation
      -> Boss Agent adapter                          (web/src/server/backend/boss-agent.ts)
         - loads compiled dist/ TaskRouter, ComplianceValidator, EscalationHandler,
           TaskStateStore, AuditLogger from the root backend
         - injects WebApprovalChannel (web/src/server/backend/approval.ts) as the
           ApprovalChannel implementation for this non-interactive HTTP context
         -> RoutingDecision { assignedAgentId, status, rationale, ... }
      -> route.ts dispatch:
         - IF assignedAgentId matches one of the hardcoded *_AGENT_ID constants with a
           real branch -> call the corresponding real backend module (content.ts,
           website-audit.ts, web-development.ts, etc.)
         - ELSE -> generateSpecialistReply() (web/src/server/backend/specialist-ai.ts):
           Claude answers in-character using the target agent's own Agents/<id>.md
           spec as system prompt ("role-play" path), under a hardcoded
           anti-fabrication / no-side-effects guardrail
      -> reply persisted to ChatMessage (Prisma) and returned to the UI
```

Two structurally different execution modes result from this dispatch:
1. **Real (dispatched):** a hardcoded `assignedAgentId === <AGENT>_AGENT_ID` branch exists in `messages/route.ts` and calls into real code (a crawler, a database write, a real API call, a real content-pipeline).
2. **Role-play (LLM only):** no such branch exists; the reply is entirely Claude's synthesis grounded only in the agent's spec file (and, for some agents, additional real "context-fed" data appended to the prompt — see below).

Per-agent classification is documented individually in each file under `docs/agents/` and summarized in `docs/agents/INDEX.md`.

## 3. The "context-fed" pattern

A middle ground exists between pure role-play and full real dispatch: some agents' prompts are supplemented with real, freshly-fetched data before Claude writes the reply. The reply text is still Claude-authored, but it is grounded in real numbers/records rather than invented ones. Confirmed examples: `performance-analytics.ts` (real Search Console/Analytics data appended), `off-page-seo.ts`, `google-sheets-integration.ts`, and `admin-agent`'s governance evidence (`admin-governance.ts`'s `buildGovernanceEvidenceContext()`, which assembles real RBAC/audit/isolation facts from the database before Claude answers a system-verification question).

## 4. The automatic multi-agent content pipeline

Triggered only when Boss Agent assigns `seo-content-agent` in chat. Implemented in `web/src/server/backend/specialist-orchestrator.ts`:

```
Stage 1: Keyword Research           -> REAL   (content.ts, real keyword/intent generation)
Stage 2: SEO Strategy               -> ROLE-PLAY (context-fed with Stage 1's real output)
Stage 3: SEO Content                -> REAL   (content.ts, real content generation)
Stage 4: On-Page SEO                -> ROLE-PLAY
Stage 5: Guest Posting (optional)   -> ROLE-PLAY, triggered only by a regex match on the
                                        user's message (needsGuestPostingStage())
```
The module's own comment states plainly: "Stages 2 (SEO Strategy), 4 (On-Page SEO), and 5 (Guest Posting) are separate specialists... and remain real `generateSpecialistReply()` calls." This is a code-documented, intentional design, not an oversight — but it means a user asking for "content" receives a reply that blends two genuinely-executed stages with three narrated ones, presented as one continuous response.

## 5. Human-approval-gated real execution (the two genuinely side-effecting pipelines)

These are the only two pipelines in the entire system where ADASOS makes a real, production-affecting change (a repository commit, a live deployment) — and both are hard-gated behind an explicit human decision, never auto-approved in a real deployment:

**A. Technical remediation** (`web/src/server/backend/remediation.ts`, `remediation-actions.ts`, root `src/boss-agent/remediation/remediation-orchestrator.ts`)
- Lifecycle: DIAGNOSE → PLAN → **APPROVAL** → EXECUTE → DEPLOY → VERIFY → RESOLVED.
- Persisted via `RemediationApproval` / `RemediationExecutionRecord` (Prisma).
- Approval is bound to a specific `GitHubConnection.id` (re-validated at decision time) and has an `expiresAt` — an expired approval is refused, not silently honored.
- The `WebApprovalChannel` (`approval.ts`) is explicit that certain escalation reasons — `deploy_production_change`, `capability_unavailable`, `low_confidence_match`, `ambiguous_match`, `requested_agent_not_found` — must **never** auto-resolve, even in this non-interactive HTTP context; they always resolve to "rejected" with an honest note rather than silently picking a candidate.

**B. Web Development Agent's website-change pipeline** (`web/src/server/backend/web-development.ts`)
- Lifecycle: plan → draft (whole-file-aware, using real current file content from GitHub) → **human approve/reject** → apply (real commit).
- Persisted via `WebDevelopmentChange` (Prisma).
- Exposed via `web/src/app/api/workspace/web-development/[id]/approve` and `.../reject` routes.
- Deliberately does NOT call the frozen root-layer `WebDevelopmentAgent` class (see `docs/agents/web-development-agent.md` for why).

See `docs/security/HUMAN_APPROVAL_SYSTEM.md` for the full approval-system documentation.

## 6. Data & storage

- **ORM:** Prisma over **SQLite**, single-process. `web/src/server/db.ts` applies `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` once per database file (not per process) to harden concurrent access **within one PM2 process** — this is explicitly documented in-code as addressing single-process concurrent-request contention, not multi-process/multi-server scaling. A Postgres migration is not implemented; horizontal scaling is explicitly out of scope for the current deployment.
- **26 Prisma models** — see `docs/database/DATA_MODEL.md` for the full model-by-model reference.
- Every sensitive model is scoped by an owning `userId`/`workspaceId` foreign key with no cross-account sharing mechanism (confirmed directly in `rbac.ts`'s own header: "every User row already IS its own fully isolated tenant... no existing 'invite a teammate' flow"). See `docs/admin/SUBSCRIPTION_READINESS.md`.
- Sensitive credentials (GitHub OAuth token; and, per code comments, newer connections) are encrypted at rest with AES-256-GCM (`web/src/server/credential-encryption.ts`). Some pre-existing connection types (WordPress, Google Search Console) store tokens as plain columns per in-code comments flagging this as a known, pre-existing gap outside a given fix's scope — see `docs/security/SECURITY_AND_GOVERNANCE.md`.

## 7. Auth & authorization

- **Authentication:** NextAuth, JWT session strategy. The full, directly-read `authOptions.providers` array in `web/src/server/auth.ts` contains only `CredentialsProvider` (email + bcrypt password hash) — sign-in is confirmed email/password only. GitHub/WordPress/Google connections elsewhere in the product are separate, app-level integration connections, not login methods. `.env.example` documents `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` with a NextAuth-style callback URL, which does not match this file's contents — see `docs/integrations/INTEGRATIONS_REFERENCE.md`'s "Discrepancy flagged" note and `docs/architecture/DOCUMENTATION_CONFLICTS.md`.
- Production hardening: at module load, if `NODE_ENV=production`, the app refuses to start if `NEXTAUTH_SECRET` is unset, is a known placeholder, or is under 32 characters.
- Login is rate-limited (`rate-limit.ts`, in-memory, single-instance): 10 attempts per 15 minutes per `ip:email` key. The module's own comment states a multi-instance deployment would need a shared store (e.g. Redis) instead.
- **Authorization (RBAC):** `web/src/server/rbac.ts` defines exactly two roles, `"owner"` and `"viewer"`. There is no separate Role/Permission table in the schema — `User.role` (default `"owner"`) is the sole enforced field. `assertAuthorized()` gates exactly one real decision point in the whole system: approving/rejecting a `RemediationApproval`. Everything else in the product is unaffected by role — client-data isolation is enforced separately and unconditionally via `userId`/`ownerId` foreign keys, regardless of role. An unknown/malformed role value fails closed to `"viewer"`. Denials are logged as a real `ActivityEvent` (category `"authorization"`).

## 8. External integrations

See `docs/integrations/INTEGRATIONS_REFERENCE.md` for the full, per-integration IMPLEMENTED / PARTIAL / NOT VERIFIED table. At the architecture level: every real external integration (GitHub, WordPress, Google Search Console, Bing Webmaster, Google Business Profile / Sheets / other Google services) follows the same shape — its own Prisma connection model, its own OAuth or token-based auth, encrypted-at-rest secrets (for models built under the credential-encryption.ts convention), and a dedicated `web/src/app/api/integrations/<name>/**` route group.

## 9. Logging, auditing, error handling

- The root backend writes structured JSONL audit events via `AuditLogger` to files under `var/` (e.g. `var/web/boss-agent/audit-log.jsonl`, `var/web/conversation-language-manager/audit-log.jsonl`) — confirmed read directly by `admin-governance.ts`'s `inspectAuditLogFile()`.
- The web layer additionally persists an `ActivityEvent` (Prisma) row for events such as authorization denials.
- Chat messages persist a `metaJson` field carrying the routing decision and any escalations, surfaced in the UI's Task Progress / Execution Log detail view.
- Errors follow an explicit anti-fabrication convention throughout the codebase: a provider that isn't configured returns `null`/a typed "not configured" error rather than fabricating a result (e.g. `AnthropicNotConfiguredError`, `CredentialEncryptionNotConfiguredError`); a check that cannot run is reported as `NOT_VERIFIED` or "skipped," never guessed.

## 10. Deployment reality

Verified from `RUN_GUIDE.md` and `web/src/server/db.ts`'s own comments: **local Windows deployment via PM2** (fork mode, one instance — `ecosystem.config.cjs`), with a custom watchdog Scheduled Task. This is explicitly documented in-code as NOT a production/cloud deployment. See `docs/deployment/DEPLOYMENT_GUIDE.md` for the full, verified-vs-not-verified breakdown.

## 11. Where to look next

- Per-agent detail: `docs/agents/`
- Exact "I want to change X, go here" table: `docs/admin/MASTER_CHANGE_MAP.md`
- Boss Agent routing internals: `docs/architecture/BOSS_AGENT_AND_ROUTING.md`
- Inter-agent communication model: `docs/architecture/AGENT_COMMUNICATION.md`
- Known documentation/scope conflicts: `docs/architecture/DOCUMENTATION_CONFLICTS.md`
