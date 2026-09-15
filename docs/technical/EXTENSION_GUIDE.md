# Extension Guide

Audience: developer/engineer. Step-by-step procedures for the two most common structural extensions. For a quick lookup of any other specific change, see `admin/MASTER_CHANGE_MAP.md`.

## Adding a new specialist agent

1. **Write the spec:** `Agents/<new-agent-id>.md`, following the existing template (Mission, Responsibilities, Inputs, Outputs, Communicates With, Tools, Rules, Success Criteria, Tags, Capabilities). Loaded directly by `AgentRegistry` at root-backend startup.
2. **(Optional) root implementation:** `src/agents/<new-agent-id>/` — only if you intend real execution logic at the root layer. Consider whether the real capability should instead live entirely in `web/src/server/backend/` (Web Development Agent's precedent — see `agents/web-development-agent.md`).
3. **Rebuild the root backend:** `npm run build` (root) so `dist/` picks up the new spec/class.
4. **Add a chat-dispatch branch (only for real, non-role-play execution):** define a `<NEW_AGENT>_AGENT_ID` constant in `web/src/app/api/workspace/messages/route.ts` and an `assignedAgentId === ...` branch calling a new/existing `web/src/server/backend/<name>.ts` module. Without this, the agent falls back to role-play automatically — a legitimate first-launch state, but must be documented as such.
5. **Real data/integration needs:** add a new Prisma model (scoped by `userId`, per convention), a migration (`npm run db:migrate:dev`), and a new `web/src/app/api/integrations/<name>/**` route group if OAuth/API-key configuration is needed — add new env vars to `.env.example` following the existing "what happens if unconfigured" honesty convention.
6. **Real production-affecting changes:** add a human-approval gate following the `RemediationApproval`/`WebDevelopmentChange` pattern — never let a new real-execution capability skip human approval.
7. **Document it:** add to `agents/INDEX.md` and write `agents/<id>.md` following the 25-field template.
8. **Add tests** (Vitest under `web/`, root tests if a root class was added) — CI fails the build if `npm test` fails in either package.
9. **Update `admin/MASTER_CHANGE_MAP.md`** if the new agent introduces a new "where do I change X" question.

## Adding a new external integration

1. **Add environment variables** to `web/.env.example` with the existing comment convention: where to get the credential, cost, and the exact "not configured" behavior.
2. **Add a Prisma connection model** if credentials must be stored — one model per provider (never merge two providers, per the Bing/Google Search Console precedent), scoped by `userId`.
3. **Encrypt any stored secret** via `credential-encryption.ts`'s `encryptSecret()`/`decryptSecret()` — never store plaintext for a new integration.
4. **Add a route group** under `web/src/app/api/integrations/<name>/**` for connect/callback/disconnect.
5. **Add a real client module** under `web/src/server/<name>.ts` exposing `getConnectionStatus()` and real read/write functions — wire it into `integration-health-check.ts` so it participates in the real health-check system.
6. **Wire it into the relevant agent(s)'** real dispatch or context-fed prompt — otherwise the integration exists but nothing in chat uses it (a real, previously-observed gap — see Website Management Agent and Google Business Profile Agent).
7. **Document it** in `technical/INTEGRATIONS_REFERENCE.md` and `technical/CONFIGURATION_REFERENCE.md`.

## General change-safety checklist

- Root (`src/`) change → requires a rebuild before the web app sees it.
- Web (`web/src/`) change → picked up by `next dev`/`next build`; a schema change additionally requires a migration.
- Any change to `NEVER_AUTO_RESOLVE_REASONS` (`approval.ts`) or the RBAC capability matrix (`rbac.ts`) is security-sensitive.
- Run `npm run typecheck`, `npm test`, and (for web) `npm run validate-startup` locally before pushing — CI enforces all three on `main`.
