# Agent Configuration

Audience: admin / developer. For a one-line answer to "where do I change agent X's behavior," start with `admin/MASTER_CHANGE_MAP.md`'s Agents section. This document covers agent configuration in depth and the step-by-step procedure for adding or removing an agent entirely.

## What defines an agent

Every agent has a spec file at `Agents/<agent-id>.md` (Mission, Responsibilities, Inputs, Outputs, Communicates With, Tools, Rules, Success Criteria, Tags, Capabilities). `AgentRegistry.load()` (`src/boss-agent/registry/agent-registry.ts`) reads every `.md` file in `Agents/` automatically at process start — there is no separate registration array to edit. This spec file is the source of truth for:

- What Boss Agent's router scores against when deciding whether a task should go to this agent (see `technical/BOSS_AGENT_AND_ROUTING.md`).
- What a role-play or context-fed agent's reply is grounded in, via `generateSpecialistReply()` in `web/src/server/backend/specialist-ai.ts`.

Editing the spec file is data, not code — it takes effect on the next process restart, no rebuild required.

## What makes an agent "real" instead of role-play

A spec file alone only ever produces role-play behavior. An agent becomes real (dispatched) or real (context-fed) only when both of these exist:

1. A dispatch branch in `web/src/app/api/workspace/messages/route.ts` — a `<NAME>_AGENT_ID` constant and an `assignedAgentId === ...` branch.
2. A real implementation the branch calls — either a root-layer class under `src/agents/<agent-id>/` (via the compiled `dist/` output) or a `web/src/server/backend/<name>.ts` module.

See `agents/INDEX.md` for the current execution-mode classification of all 27 agents, and each agent's own file (field 20, "Exact routing/dispatch location") for the precise line to look at.

## Editing an existing agent

| Task | File(s) | Rebuild/restart | Test |
|---|---|---|---|
| Change mission/responsibilities/rules text | `Agents/<agent-id>.md` | Restart web app only (registry is cached per-process) | Re-test routing with a range of task descriptions |
| Change the fixed guardrail text every role-play/context-fed reply gets | `web/src/server/backend/specialist-ai.ts` (`buildSystemPrompt()`) | Rebuild/restart web app | Send a chat message to a role-played agent; confirm guardrails still hold |
| Change a real agent's execution logic | The relevant `web/src/server/backend/<name>.ts` module (see that agent's field 19/20) | Rebuild/restart web app (and rebuild root first if a `src/agents/<id>/` class changed) | Exercise the real capability end-to-end |
| Change which agent IDs get a real dispatch branch | `web/src/app/api/workspace/messages/route.ts` | Rebuild/restart web app | Send a chat message routed to that ID; check server logs for the `[module-name]` prefix |

## Adding a new specialist agent

1. **Write the spec:** create `Agents/<new-agent-id>.md` following the existing template (Mission, Responsibilities, Inputs, Outputs, Communicates With, Tools, Rules, Success Criteria, Tags, Capabilities).
2. **(Optional) create a root implementation:** `src/agents/<new-agent-id>/` — only required for real (non-role-play) execution logic at the root layer. Consider whether the real capability should instead live entirely in `web/src/server/backend/` (the Web Development Agent's precedent of intentionally not using a root-layer class is documented in `agents/web-development-agent.md`).
3. **Rebuild the root backend:** `npm run build` (repo root) — so `dist/` picks up the new/changed spec and any new class.
4. **Add a chat-dispatch branch, only if you want real execution instead of role-play:** in `web/src/app/api/workspace/messages/route.ts`, define a `<NEW_AGENT>_AGENT_ID` constant and add an `assignedAgentId === ...` branch calling into a new or existing `web/src/server/backend/<name>.ts` module. Without this step, the new agent automatically falls back to role-play via `generateSpecialistReply()` — a legitimate first-launch state, but it must be documented as such.
5. **If the new agent needs real data or an external integration:** add a new Prisma model scoped by `userId` (see `admin/DATA_AND_STORAGE.md`), a migration (`npm run db:migrate:dev`), and a new `web/src/app/api/integrations/<name>/**` route group if OAuth/API-key configuration is needed (add the new env vars to `.env.example` with the same "what happens if unconfigured" honesty convention every existing integration follows — see `admin/INTEGRATION_CONFIGURATION.md`).
6. **If the new capability makes a real, production-affecting change:** add a human-approval gate following the `RemediationApproval`/`WebDevelopmentChange` pattern — never let a new real-execution capability skip human approval (see `admin/SECURITY_AND_GOVERNANCE.md`).
7. **Add the agent to `agents/INDEX.md` and write its individual `agents/<id>.md`** following the 25-field template used for all 27 existing agents.
8. **Add tests** (Vitest under `web/`, and root-package tests if a root class was added) — CI will fail the build if `npm test` fails in either package.
9. **Update `admin/MASTER_CHANGE_MAP.md`** if the new agent introduces a new kind of "where do I change X" question.

## Removing a specialist agent

1. Delete or rename `Agents/<agent-id>.md` — this removes it from the registry on the next process restart.
2. Remove any dedicated dispatch branch in `web/src/app/api/workspace/messages/route.ts` referencing that agent's ID.
3. Remove any `src/agents/<agent-id>/` implementation code no longer needed.
4. Remove or archive `agents/<agent-id>.md` and its row in `agents/INDEX.md`.
5. `npm test`; confirm no remaining code references the removed agent ID (`grep -r "<agent-id>"` across `web/src` and `src`).

## Known configuration gaps (recorded, not fixed)

Several agents have a real, separately-existing integration that is not confirmed wired into that specific agent's own chat dispatch (for example, WordPress publishing and the Website Management Agent; Google Business Profile OAuth and the Google Business Profile Agent). Wiring these up is a legitimate future configuration task, not a defect requiring an urgent fix — see each agent's own "Known limitations" field and `technical/DOCUMENTATION_CONFLICTS.md`.
