# Change Management Guide

Audience: admin / developer. For the single-lookup version of "where do I change X," always start with `docs/admin/MASTER_CHANGE_MAP.md` — this guide covers the two most common *structural* changes (adding a new agent, adding a new integration) in step-by-step form.

## Adding a new specialist agent

1. **Write the spec:** create `Agents/<new-agent-id>.md` following the existing template (Mission, Responsibilities, Inputs, Outputs, Communicates With, Tools, Rules, Success Criteria, Tags, Capabilities). This file is the source of truth for the agent's role-play behavior and is loaded directly by `AgentRegistry` at root-backend startup.
2. **(Optional) create a root implementation:** `src/agents/<new-agent-id>/` — only required if you intend real (non-role-play) execution logic at the root layer. Confirm whether your intended real capability should instead live entirely in `web/src/server/backend/` (see Web Development Agent's precedent of intentionally NOT using a root-layer class — `docs/agents/web-development-agent.md`).
3. **Rebuild the root backend** so `dist/` picks up the new/changed spec and any new class: `npm run build` (root).
4. **Add a chat-dispatch branch (only if you want real execution, not role-play):** in `web/src/app/api/workspace/messages/route.ts`, define a `<NEW_AGENT>_AGENT_ID` constant and add an `assignedAgentId === ...` branch calling into a new or existing `web/src/server/backend/<name>.ts` module. Without this step, the new agent automatically falls back to role-play via `generateSpecialistReply()` — which is a legitimate first-launch state, but must be documented as such (see `docs/agents/INDEX.md`'s execution-mode legend).
5. **If the new agent needs real data or a real external integration:** add a new Prisma model (scoped by `userId`, following the existing convention — see `docs/database/DATA_MODEL.md`), a migration (`npm run db:migrate:dev`), and a new `web/src/app/api/integrations/<name>/**` route group if it needs OAuth/API-key configuration (add the new env vars to `.env.example` with the same "what happens if unconfigured" honesty convention every existing integration follows).
6. **If the new capability makes a real, production-affecting change:** add a human-approval gate following the `RemediationApproval`/`WebDevelopmentChange` pattern — never let a new real-execution capability skip human approval, per `GLOBAL_RULES.md` §9/§13.
7. **Add the agent to `docs/agents/INDEX.md` and write its individual `docs/agents/<id>.md`** following the existing 27-agent template — this documentation set only covers the 27 verified as of this pass; a newly added agent is not documented until added here.
8. **Add tests** (Vitest under `web/`, and root-package tests if a root class was added) — CI (`ci.yml`) will fail the build if `npm test` fails in either package.
9. **Update `admin/MASTER_CHANGE_MAP.md`** if the new agent introduces a new kind of "where do I change X" question.

## Adding a new external integration

1. **Add environment variables** to `web/.env.example` with a comment following the existing convention: where to get the credential, whether it's free/paid, the exact behavior if unconfigured (must be an honest "not configured" state, never a fabricated fallback).
2. **Add a Prisma connection model** if the integration requires storing tokens/credentials — follow the one-model-per-provider convention (never merge two providers into one model, per the Bing/Google Search Console precedent) and scope it by `userId` (add `@unique` if only one connection per user is meaningful).
3. **Encrypt any stored secret** using `web/src/server/credential-encryption.ts`'s `encryptSecret()`/`decryptSecret()` — never store a plaintext token for a new integration, regardless of any pre-existing gaps documented for older integrations (see `docs/security/SECURITY_AND_GOVERNANCE.md`'s Conflict 8).
4. **Add a route group** under `web/src/app/api/integrations/<name>/**` for connect/callback/disconnect, following the existing OAuth or API-key pattern most similar integrations use.
5. **Add a real client module** under `web/src/server/<name>.ts` exposing `getConnectionStatus()` and whatever real read/write functions the integration needs — this is also what should be wired into `integration-health-check.ts` so the new integration participates in the real health-check system rather than being silently unchecked.
6. **Wire it into the relevant agent(s)' real dispatch or context-fed prompt**, if applicable — otherwise the integration exists but nothing in chat will use it (a real, previously-observed gap pattern; see Website Management Agent and Google Business Profile Agent's docs for two existing examples of this exact situation).
7. **Document it** in `docs/integrations/INTEGRATIONS_REFERENCE.md` and `docs/configuration/ENVIRONMENT_VARIABLES.md`.

## General change-safety checklist (any change)

- Root (`src/`) change → requires a rebuild (`dist/`) before the web app sees it.
- Web (`web/src/`) change → picked up by `next dev`/`next build` normally; a schema change additionally requires a migration.
- Any change to `NEVER_AUTO_RESOLVE_REASONS` (`approval.ts`) or the RBAC capability matrix (`rbac.ts`) is security-sensitive — review carefully, since these are the enforcement points for "a human must approve production changes."
- Run `npm run typecheck`, `npm test`, and (for web) `npm run validate-startup` locally before pushing — CI enforces all of these on `main`.
