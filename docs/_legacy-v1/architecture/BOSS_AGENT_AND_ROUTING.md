# Boss Agent & Routing

Audience: admin / developer. Covers the deterministic routing engine at the core of ADASOS.

## Two Boss Agent layers — do not confuse them

1. **Root backend `BossAgent` facade** (`src/boss-agent/boss-agent.ts`) — the real, deterministic orchestration class. Wires together `AgentRegistry`, `TaskRouter`, `ComplianceValidator`, `EscalationHandler`, `AuditLogger`, `TaskStateStore`. `BossAgent.create(config)` loads the real agent registry from disk (`Agents/*.md`) and builds a `TagWeightedRoutingStrategy` from it. **`BossAgent.run()` never executes a specialist agent — it only ever produces a `RoutingDecision`.** This is stated explicitly in the file's own header comment, and is the source of the scope language also found in root `README.md`.
2. **`BossOrchestrator`** (`src/boss-agent/boss-orchestrator.ts`) — a thin lifecycle shell (`start()`/`stop()`) around the `BossAgent` facade above, adding its own `orchestrator_started`/`orchestrator_stopped` audit events. It does not add routing logic of its own.
3. **Web-layer adapter** (`web/src/server/backend/boss-agent.ts`) — NOT a reimplementation. It dynamically imports the **compiled** `dist/` output of the root backend's `TaskRouter`, `ComplianceValidator`, `EscalationHandler`, `TaskStateStore`, `AuditLogger` classes, and supplies `WebApprovalChannel` (`approval.ts`) as this context's `ApprovalChannel` implementation (since the CLI's blocking terminal prompt has no equivalent in a stateless HTTP request).

**Practical implication:** editing `src/boss-agent/**` changes only the *root* engine; the web app will not see that change until the project is rebuilt (`dist/` regenerated) and the web server picks up the new compiled output. See `admin/MASTER_CHANGE_MAP.md`.

## Routing is deterministic, not LLM-based

`TagWeightedRoutingStrategy` scores candidate agents by keyword/IDF-weighted overlap between the incoming task description and each agent's spec (blended with the optional `Tags`/`Capabilities` sections of `Agents/<id>.md`, when present — the strategy degrades gracefully to plain keyword matching for any agent without tags). **No LLM call is made to decide routing itself.** The LLM (Claude) is only invoked afterward, to generate the specialist's actual reply (see `docs/architecture/ARCHITECTURE.md` §2).

`TaskRouter` (root, `src/boss-agent/routing/task-router.ts` — file located but not fully read in this documentation pass; behavior below is inferred from its confirmed call sites in `boss-agent.ts` and `approval.ts` and should be verified directly before relying on exact thresholds) applies:
- `autoAssignThreshold` — a best-candidate score must clear this to auto-assign without escalation.
- `tieMargin` — if the top two candidates are within this margin, the match is `ambiguous_match` rather than auto-assigned.
- A capability/intent pre-gate for at least one confirmed case (`prospecting-intent-detector.ts`, referenced in `approval.ts`'s own comments) that routes a clearly-identified request to its correct specialist deterministically, before scoring — added specifically to fix a real, observed low-confidence-routing defect.

**NOT VERIFIED IN CURRENT CODEBASE in this pass:** the exact numeric values of `autoAssignThreshold`, `tieMargin`, and `maxCandidates` as currently configured (`src/boss-agent/config/boss-agent.config.ts` was not read directly) — one real value was seen quoted in an in-code comment (0.31 scored against a 0.50 threshold, describing a specific past defect), which should not be assumed to be the current permanent configuration. Confirm directly in `boss-agent.config.ts` before documenting a specific number to a client or admin.

## Escalation reasons and what happens to each

`RoutingDecision.status` can require escalation for several distinct reasons, each handled by `EscalationHandler` and (in the web layer) by `WebApprovalChannel.requestDecision()`:

| Reason | Meaning | Auto-resolves in web (non-interactive) context? |
|---|---|---|
| `capability_unavailable` | Boss Agent honestly determined no real agent can execute this; `candidates[]` is audit-only (every entry `score: 0`), not a ranked recommendation | **Never** — always resolves to `rejected` with an honest note |
| `deploy_production_change` | A real, registered execution adapter exists and this would make a real production-affecting change | **Never** — always resolves to `rejected`; a real human decision is required |
| `low_confidence_match` | Best candidate score did not clear `autoAssignThreshold` | **Never** — always resolves to `rejected`, asking the user to rephrase or specify |
| `ambiguous_match` | Best candidate score cleared the threshold but was too close to the runner-up | **Never** — always resolves to `rejected` |
| `requested_agent_not_found` | The user explicitly named an agent that does not exist in the real registered roster | **Never** — always resolves to `rejected`, `candidates[]` is always empty for this reason |
| (any other reason) | — | Auto-resolves to `candidates[0]` with the note "Auto-resolved to the top-ranked option... for a non-blocking web request" |

This list (`NEVER_AUTO_RESOLVE_REASONS` in `approval.ts`) was built up across multiple documented bug-fix passes, each one closing a real, observed case where an honest "I'm not confident"/"I can't do this" signal from `TaskRouter` was being silently converted into a confident-looking auto-assignment. Any future change to this set should be treated as security/trust-sensitive, not cosmetic.

## Follow-up routing heuristics

`web/src/server/backend/follow-up-routing.ts` adds continuity logic on top of per-message routing — e.g. "Audit my website" followed by "Now fix the issues you found" is heuristically routed back toward the audit/remediation continuity rather than re-scored from zero context. It includes an explicit carve-out so a request for a genuinely different capability (e.g. "fix" after an audit, when Website Audit Agent is diagnostic-only) is not silently misrouted back to the wrong agent. Exact heuristic rules were not fully read in this documentation pass — **NOT VERIFIED IN CURRENT CODEBASE** beyond the audit → remediation example confirmed via `website-audit-agent.md`'s own research.

## Conversation Language Manager (CLM)

Sits in front of Boss Agent routing specifically in the chat path (`web/src/server/backend/conversation.ts`). Responsibilities: language detection, intent classification, and prompt-injection escalation, before a task ever reaches the Boss Agent router. It has its own audit log file (`var/web/conversation-language-manager/audit-log.jsonl`, confirmed read by `admin-governance.ts`). A dedicated architecture doc for this subsystem already exists at the repository's own `docs/architecture/ConversationLanguageManager.md` — preserved, not duplicated; see `docs/architecture/DOCUMENTATION_CONFLICTS.md` for how the two relate.

## Where to modify

- **Routing weights/strategy:** `src/boss-agent/routing/tag-weighted-routing-strategy.ts`, `task-router.ts`.
- **Thresholds:** `src/boss-agent/config/boss-agent.config.ts` (confirm current values directly before changing).
- **Escalation auto-resolve behavior (web):** `web/src/server/backend/approval.ts` — treat changes to `NEVER_AUTO_RESOLVE_REASONS` as security-sensitive.
- **Agent registry (what agents exist):** `Agents/*.md` — adding a new spec file here plus a matching `src/agents/<id>/` folder is how a new agent enters the routable roster. See `docs/change-management/CHANGE_MANAGEMENT_GUIDE.md`.
- **Follow-up continuity heuristics:** `web/src/server/backend/follow-up-routing.ts`.
- **CLM behavior:** see `docs/architecture/ConversationLanguageManager.md` (pre-existing) and its own source location.
