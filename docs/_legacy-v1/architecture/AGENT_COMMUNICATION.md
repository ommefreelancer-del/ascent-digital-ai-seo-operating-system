# Agent Communication Model

Audience: admin / developer.

## No message bus

Agents do not communicate via a shared message queue, event bus, or pub/sub system. Per `workflows/Protocols/agent-communication-protocol.md` (existing repository document, preserved and summarized here, not replaced): agents communicate through **typed method calls and a shared `WorkflowContext`** object passed explicitly between orchestration steps. This is true for the root backend's workflow files (e.g. `src/workflows/seo-audit-workflow.ts`) and, structurally, for the web layer's own orchestration modules (`specialist-orchestrator.ts` passes real upstream stage output forward as prompt context for the next stage, rather than publishing an event another module subscribes to).

## What "Receives from / Sends to" means in each agent spec

Every `Agents/<id>.md` file lists a `Communicates With` section (Receives from / Sends to other agent names). This documents the **intended, spec-level data-flow design** — it does not, by itself, prove a real code path exists connecting those two agents today. Cross-reference the individual agent's `docs/agents/<id>.md` "Workflows that use it" and "Execution mode" sections before assuming a spec'd communication link is actually wired in the live web product. Many of the 27 agents' specs describe rich bidirectional communication with other agents, while their actual web-layer execution is role-play-only with no real data ever passed from the named upstream agent (see `docs/architecture/DOCUMENTATION_CONFLICTS.md` and each agent's "Known limitations").

## Real inter-stage data passing (the one confirmed case)

The clearest, code-verified example of one agent's real output becoming another's real input is the automatic content pipeline (`specialist-orchestrator.ts`): Stage 1 (Keyword Research, real) output is passed as literal text context into the Stage 2 (SEO Strategy, role-play) prompt. This is "context-fed," not a generic inter-agent protocol — it is pipeline-specific code, not a reusable mechanism other agent pairs automatically get.

## Root-layer workflow orchestration

The four root workflow files (see `docs/workflows/` for individual documentation) coordinate agents by directly instantiating and calling their classes in sequence within one script/module, passing a shared context object between steps — not by dispatching to independently-running agent processes. There is no evidence of agents running as separate processes/services that talk over a network protocol; everything examined runs in-process within the web server (Next.js) or within a one-shot root-backend script run.

## Audit trail as the durable record of interaction

Because there is no message bus, the closest thing to a durable, queryable record of "what did agent X hand to agent Y" is the `AuditLogger` JSONL trail under `var/` plus each Prisma model's own JSON snapshot fields (e.g. `RemediationApproval.taskJson`, `CampaignRecord.resultJson`). These record what a given step produced and when, not a formal message envelope.

## Where to modify

- **Protocol definition (design intent):** `workflows/Protocols/agent-communication-protocol.md` (pre-existing, authoritative for the intended model).
- **Real content-pipeline stage wiring:** `web/src/server/backend/specialist-orchestrator.ts`.
- **Root workflow step sequencing:** `src/workflows/*.ts`.
- **Audit trail format:** `AuditLogger` (root, under `src/core/governance/`) and its `var/` output paths.
