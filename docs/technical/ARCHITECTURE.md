# System Architecture

Audience: developer/engineer. Companion documents: `SYSTEM_COMPONENTS.md` (component inventory), `BOSS_AGENT_AND_ROUTING.md`, `AGENT_ARCHITECTURE.md`, `AGENT_COMMUNICATION.md`, `WORKFLOW_ARCHITECTURE.md`.

## 1. Two-codebase structure

**A. Root backend** (`src/`, `Agents/*.md`, compiled to `dist/`) — package `adasos-boss-agent`. A frozen, deterministic Boss Agent orchestration and routing engine. Routing is keyword/IDF-weighted scoring (`TagWeightedRoutingStrategy`), never an LLM call. Its own `README.md` states "No specialist agent is executed... never a specialist agent logic or module is implemented here" — accurate for this package specifically, not the whole product (see `DOCUMENTATION_CONFLICTS.md`, Unresolved 1).

**B. `web/`** — the real, running Next.js 15 / React 19 product (package `adasos-web`, v2.0.0). Dynamically imports the compiled root output (`import(/* webpackIgnore: true */ \`file://${target}\`)` against `dist/src/...`, never `src/` directly — confirmed in `web/src/server/backend/boss-agent.ts`). Adds persistence (Prisma/SQLite), auth (NextAuth), real external integrations, and the LLM layer (Anthropic Claude, optionally Google Gemini) the root backend does not have.

**Practical consequence:** a change under `src/` requires a rebuild (`dist/` regenerated) before the web app sees it. A change under `web/src/` is picked up by the normal Next.js dev/build cycle. See `admin/MASTER_CHANGE_MAP.md`.

## 2. Request-flow layers (chat path — the primary product surface)

```
User message (web UI)
  -> web/src/app/api/workspace/messages/route.ts   (API route, session-scoped)
     -> Conversation Language Manager (CLM)         (web/src/server/backend/conversation.ts)
        - language detection / intent classification / prompt-injection escalation
     -> Boss Agent adapter                          (web/src/server/backend/boss-agent.ts)
        - dynamically imports compiled dist/ TaskRouter, ComplianceValidator,
          EscalationHandler, TaskStateStore, AuditLogger
        - injects WebApprovalChannel (web/src/server/backend/approval.ts)
        -> RoutingDecision { assignedAgentId, status, rationale, ... }
     -> route.ts dispatch:
        - IF assignedAgentId matches a hardcoded *_AGENT_ID with a real branch
          -> call the corresponding real backend module
        - ELSE -> generateSpecialistReply() (specialist-ai.ts): Claude answers
          in-character using the target agent's Agents/<id>.md spec as system
          prompt ("role-play"), under a hardcoded anti-fabrication guardrail
     -> reply persisted to ChatMessage (Prisma), returned to the UI
```

Two execution modes result: **real (dispatched)** — a hardcoded branch calls real code; **role-play (LLM only)** — no such branch exists, Claude synthesizes from the spec. See `agents/INDEX.md` for the per-agent classification.

## 3. The "context-fed" pattern

A middle ground: some prompts are supplemented with real, freshly-fetched data before Claude writes the reply — the reply text is Claude-authored but grounded in real numbers. Confirmed: `performance-analytics.ts`, `off-page-seo.ts`, `google-sheets-integration.ts`, and `admin-governance.ts`'s `buildGovernanceEvidenceContext()`.

## 4. The automatic multi-agent content pipeline

Triggered when Boss Agent assigns `seo-content-agent`. See `technical/WORKFLOW_ARCHITECTURE.md` and `technical/workflows/CONTENT_GENERATION_WORKFLOW.md` for the full 5-stage breakdown (`specialist-orchestrator.ts`).

## 5. Human-approval-gated real execution

Two pipelines make real, production-affecting changes, both hard-gated behind explicit human approval: **Technical Remediation** (`remediation.ts`, scope confirmed limited to robots.txt/sitemap.xml/canonical-link — see `DOCUMENTATION_CONFLICTS.md` Resolved 4) and **Web Development Agent's website-change pipeline** (`web-development.ts`). See `technical/AUTH_AND_RBAC.md` and `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md`.

## 6. Data & storage

Prisma ORM over SQLite, single-process, WAL-mode hardened (`web/src/server/db.ts`). 26 models, every sensitive one scoped by an owning `userId`/`workspaceId` foreign key with no cross-account sharing. See `technical/DATABASE_REFERENCE.md`. Credential encryption: AES-256-GCM (`credential-encryption.ts`), confirmed in active use for GitHub, WordPress, and Google Search Console connections (see `DOCUMENTATION_CONFLICTS.md` Resolved 2).

## 7. Auth & authorization

NextAuth, JWT sessions, `CredentialsProvider` only (email + bcrypt) — confirmed the sole registered provider. `GOOGLE_CLIENT_ID`/`SECRET` power Google *service* connections (Business Profile, Sheets, Gmail, Drive, Search Console), not login (see `DOCUMENTATION_CONFLICTS.md` Resolved 1). RBAC: two roles (`owner`/`viewer`), fail-closed, gating exactly one capability (`approveRemediation`/`rejectRemediation`). See `technical/AUTH_AND_RBAC.md`.

## 8. External integrations

See `technical/INTEGRATIONS_REFERENCE.md`.

## 9. Logging, auditing, error handling

See `technical/LOGGING_AND_AUDIT.md` and `technical/ERROR_HANDLING.md`.

## 10. Deployment reality

Local Windows PM2 deployment with a watchdog Scheduled Task — explicitly not a cloud/hosted production deployment. See `technical/DEPLOYMENT_REFERENCE.md`.

## 11. Where to look next

- Component inventory: `technical/SYSTEM_COMPONENTS.md`
- Routing internals: `technical/BOSS_AGENT_AND_ROUTING.md`
- Per-agent structural pattern: `technical/AGENT_ARCHITECTURE.md`
- Inter-agent data flow: `technical/AGENT_COMMUNICATION.md`
- Exact "where do I change X": `admin/MASTER_CHANGE_MAP.md`
- All recorded conflicts: `technical/DOCUMENTATION_CONFLICTS.md`
