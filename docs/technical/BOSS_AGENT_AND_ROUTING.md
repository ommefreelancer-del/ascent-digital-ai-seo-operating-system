# Boss Agent & Routing

Audience: developer/engineer.

## Three layers — do not confuse them

1. **Root `BossAgent` facade** (`src/boss-agent/boss-agent.ts`) — wires `AgentRegistry`, `TaskRouter`, `ComplianceValidator`, `EscalationHandler`, `AuditLogger`, `TaskStateStore`. `BossAgent.run()` never executes a specialist — only produces a `RoutingDecision` (stated explicitly in the file's own header).
2. **`BossOrchestrator`** (`src/boss-agent/boss-orchestrator.ts`) — a thin `start()`/`stop()` lifecycle shell around the facade, adding its own `orchestrator_started`/`orchestrator_stopped` audit events.
3. **Web-layer adapter** (`web/src/server/backend/boss-agent.ts`) — dynamically imports the **compiled** `dist/` output of the root classes and supplies `WebApprovalChannel` as the `ApprovalChannel` implementation (the CLI's blocking terminal prompt has no equivalent in a stateless HTTP request).

**A root-layer change requires a rebuild** (`dist/` regenerated) before the web app sees it.

## Routing is deterministic, not LLM-based

`TagWeightedRoutingStrategy` scores candidates by keyword/IDF-weighted overlap between the task description and each agent's spec, blended with the optional `Tags`/`Capabilities` sections of `Agents/<id>.md` (degrades to plain keyword matching for an agent without tags). **No LLM call decides routing.** The LLM is invoked only afterward to generate the specialist's reply.

## Confirmed routing configuration (`src/boss-agent/config/boss-agent.config.ts`)

| Setting | Default | Override env var |
|---|---|---|
| `autoAssignThreshold` | 0.5 | `BOSS_AGENT_AUTO_ASSIGN_THRESHOLD` |
| `tieMargin` | 0.1 | `BOSS_AGENT_TIE_MARGIN` |
| `maxCandidates` | 5 | `BOSS_AGENT_MAX_CANDIDATES` |
| `agentsDirectory` | `<repo>/Agents` | `BOSS_AGENT_AGENTS_DIR` |
| `stateDirectory` | `<repo>/var/boss-agent/state` | `BOSS_AGENT_STATE_DIR` |
| `auditLogPath` | `<repo>/var/boss-agent/audit-log.jsonl` | `BOSS_AGENT_AUDIT_LOG` |

No secrets are required by this module — routing is fully deterministic and makes no external API calls.

`TaskRouter` also applies a capability/intent pre-gate for at least one confirmed case (`prospecting-intent-detector.ts`) that routes a clearly-identified request to its correct specialist deterministically, before scoring — added to fix a real, observed low-confidence-routing defect.

## Escalation reasons and web-layer resolution behavior

| Reason | Meaning | Auto-resolves in the non-interactive web context? |
|---|---|---|
| `capability_unavailable` | No real agent can execute this; `candidates[]` is audit-only (every entry `score: 0`) | **Never** — always `rejected` with an honest note |
| `deploy_production_change` | A real adapter exists and this would make a real production-affecting change | **Never** — always `rejected`; requires genuine human approval |
| `low_confidence_match` | Best candidate score did not clear `autoAssignThreshold` (0.5 default) | **Never** — always `rejected` |
| `ambiguous_match` | Best score cleared the threshold but was too close to the runner-up (within `tieMargin`, 0.1 default) | **Never** — always `rejected` |
| `requested_agent_not_found` | User explicitly named a nonexistent agent; `candidates[]` always empty | **Never** — always `rejected` |
| (any other reason) | — | Auto-resolves to `candidates[0]`, noted as "Auto-resolved... for a non-blocking web request" |

This set (`NEVER_AUTO_RESOLVE_REASONS` in `web/src/server/backend/approval.ts`) was built across multiple bug-fix passes, each closing a real, observed case where an honest "not confident"/"can't do this" signal was being silently converted into a confident-looking auto-assignment. Treat any change to this set as security/trust-sensitive.

## Follow-up routing heuristics

`web/src/server/backend/follow-up-routing.ts` adds continuity across turns (e.g. "Audit my website" → "Now fix the issues you found" continues toward remediation) with an explicit carve-out preventing a genuinely different capability request from being misrouted back to a diagnostic-only agent.

## Conversation Language Manager (CLM)

Sits in front of routing in the chat path (`web/src/server/backend/conversation.ts`): language detection, intent classification, prompt-injection escalation. Has its own audit log (`var/web/conversation-language-manager/audit-log.jsonl`). A dedicated existing architecture doc: `docs/architecture/ConversationLanguageManager.md` (pre-existing, preserved).

## Where to modify

- Routing weights/strategy: `src/boss-agent/routing/tag-weighted-routing-strategy.ts`, `task-router.ts`.
- Thresholds: `src/boss-agent/config/boss-agent.config.ts` (or the `BOSS_AGENT_*` env vars — no code change needed for a threshold tweak).
- Escalation auto-resolve behavior: `web/src/server/backend/approval.ts` (`NEVER_AUTO_RESOLVE_REASONS`) — security-sensitive.
- Agent roster: `Agents/*.md` plus a matching `src/agents/<id>/` folder — see `technical/EXTENSION_GUIDE.md`.
- Follow-up continuity: `web/src/server/backend/follow-up-routing.ts`.
