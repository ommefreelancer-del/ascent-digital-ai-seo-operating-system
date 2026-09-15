# Agent Communication Model

Audience: developer/engineer.

## No message bus

Agents do not communicate via a message queue, event bus, or pub/sub system. Per `workflows/Protocols/agent-communication-protocol.md` (pre-existing repository document, preserved, summarized here): agents communicate through **typed method calls and a shared `WorkflowContext`** object passed explicitly between orchestration steps — true for the root backend's workflow files and, structurally, for the web layer's own orchestration (`specialist-orchestrator.ts` passes real upstream output forward as prompt context, not via a subscribed event).

## Spec-level "Communicates With" vs. real wiring

Every `Agents/<id>.md` spec lists a `Communicates With` section describing intended data flow. This documents design intent — it does not by itself prove a real code path connects those two agents today. Cross-reference the individual agent's `docs/agents/<id>.md` before assuming a spec'd link is wired into the live product. See `DOCUMENTATION_CONFLICTS.md` Unresolved 2.

## Real inter-stage data passing (the confirmed case)

The clearest, code-verified example: the automatic content pipeline (`specialist-orchestrator.ts`) passes Stage 1's (Keyword Research, real) output as literal text context into Stage 2's (SEO Strategy, role-play) prompt. This is pipeline-specific "context-feeding," not a generic reusable protocol other agent pairs automatically get.

## Root-layer workflow orchestration

The root workflow files (`docs/technical/WORKFLOW_ARCHITECTURE.md`) coordinate agents by directly instantiating and calling their classes in sequence within one script, passing a shared context object between steps — not by dispatching to independently-running processes. No evidence was found of agents running as separate processes/services communicating over a network protocol.

## Audit trail as the durable record

With no message bus, the closest durable, queryable record of "what did step X hand to step Y" is the `AuditLogger` JSONL trail under `var/` plus each Prisma model's own JSON snapshot fields (`RemediationApproval.taskJson`, `CampaignRecord.resultJson`, etc.).

## Where to modify

- Protocol definition (design intent): `workflows/Protocols/agent-communication-protocol.md`.
- Real content-pipeline stage wiring: `web/src/server/backend/specialist-orchestrator.ts`.
- Root workflow step sequencing: `src/workflows/*.ts`.
- Audit trail format: `AuditLogger` (`src/core/governance/`).
