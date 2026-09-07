# Documentation Maintenance

Audience: admin / owner / whoever maintains this documentation set. This documentation set (`docs/`) is a snapshot, verified against the codebase as of the date of this pass (see `README.md`'s versioning note). It will drift from the real code over time unless treated as a first-class maintenance responsibility.

## The governing rule

**No significant system change is complete until the relevant documentation is updated.** A code change that alters behavior described in this documentation set is not "done" when the code merges — it is done when the corresponding doc file(s) are updated in the same change or a clearly tracked follow-up.

## Change-to-documentation matrix

| If you change... | You must update... |
|---|---|
| An agent's execution mode (role-play → real, or vice versa) | That agent's `agents/<id>.md` fields 17, 19, 20, 24, 25; `agents/INDEX.md`'s table and summary counts |
| An agent's spec file (`Agents/<id>.md`) | `agents/<id>.md` if the change affects mission/responsibilities/scope described there |
| A dispatch branch in `messages/route.ts` | The relevant agent's field 20; `technical/BOSS_AGENT_AND_ROUTING.md` if it changes general dispatch behavior |
| Routing thresholds or the scoring algorithm | `technical/BOSS_AGENT_AND_ROUTING.md`, `admin/SYSTEM_CONFIGURATION.md` |
| A workflow's steps or classification (AUTOMATIC / HUMAN APPROVAL REQUIRED / RECOMMENDATION ONLY / NOT CURRENTLY IMPLEMENTED) | The relevant `technical/workflows/<NAME>.md` file, `technical/WORKFLOW_ARCHITECTURE.md`, `admin/WORKFLOW_CONFIGURATION.md` |
| A new or changed environment variable | `admin/SYSTEM_CONFIGURATION.md`, `web/.env.example`'s own comment |
| A new integration, or a change to an existing one's status | `technical/INTEGRATIONS_REFERENCE.md`, `admin/INTEGRATION_CONFIGURATION.md` |
| A new or changed Prisma model | `technical/DATABASE_REFERENCE.md`, `admin/DATA_AND_STORAGE.md` |
| A change to RBAC, auth, encryption, or an approval gate | `technical/AUTH_AND_RBAC.md`, `technical/SECURITY_ARCHITECTURE.md`, `admin/SECURITY_AND_GOVERNANCE.md` |
| A change to any row's answer in `admin/MASTER_CHANGE_MAP.md` | That row, in the same change/PR — a stale Master Change Map is a real defect, not a cosmetic one |
| A change to deployment/PM2/watchdog configuration | `admin/DEPLOYMENT_OPERATIONS.md`, `technical/DEPLOYMENT_REFERENCE.md` |
| Anything that resolves a `NOT VERIFIED IN CURRENT CODEBASE` flag | Remove the flag from every file where it appears and record what was confirmed, including `technical/DOCUMENTATION_CONFLICTS.md` if it was logged there |
| Anything that changes subscription/multi-tenant readiness | `admin/SUBSCRIPTION_READINESS.md` |

## Rules

1. **Any change that alters a `MASTER_CHANGE_MAP.md` row's answer must update that row in the same change.** This is the single most load-bearing document for a future maintainer.
2. **Any change to an agent's execution mode** must update that agent's own file and `agents/INDEX.md`'s summary counts in the same change.
3. **Any new agent, integration, or Prisma model** must be added to the relevant reference doc per the matrix above.
4. **Never delete or silently overwrite an existing hand-authored doc** to resolve an apparent conflict with newer documentation — record the conflict in `technical/DOCUMENTATION_CONFLICTS.md` instead and let a human reconcile it.
5. **Anything marked `NOT VERIFIED IN CURRENT CODEBASE`** is an open item, not a permanent state — when someone does verify it, update the relevant file to remove the flag and record what was confirmed.
6. **A documentation-only change is legitimate** — do not require every doc update to be bundled with a functional code change; drift correction on its own is valuable and should not be blocked.
7. **Recommended cadence:** a full re-audit (re-verifying agent execution modes, integration statuses, and the change map) at least once per major version bump of `web/package.json`, or after any change touching `messages/route.ts`'s dispatch branches, `schema.prisma`, or `rbac.ts`.

## Ownership and review

- The owner/admin is responsible for ensuring documentation updates happen — there is no automated documentation-sync tooling in this codebase as of this pass (`NOT VERIFIED IN CURRENT CODEBASE` beyond what is described here).
- A documentation change touching security-relevant claims (encryption status, RBAC behavior, approval gates) should be reviewed by a second person before being trusted, the same way a code change to those files would be.
- A documentation change that removes a `NOT VERIFIED IN CURRENT CODEBASE` flag should cite the exact code evidence (file + function/line) that justified the removal, either in the commit message or inline in the doc.

## How to re-verify a specific claim quickly

- **Is agent X real or role-play in chat?** Grep `messages/route.ts` for `<X>_AGENT_ID` and check whether it appears in an `assignedAgentId === ...` branch with real logic, or falls through to `generateSpecialistReply()`.
- **Is integration Y wired into chat?** Grep the relevant `web/src/server/backend/*.ts` module for a call to the integration's client module (`web/src/server/<y>.ts`), and confirm that module is actually invoked from a chat-dispatch branch, not just from a Settings/Integrations UI route.
- **Is a Prisma field really encrypted?** Grep for the literal call site `encryptSecret(` and confirm the field in question is the argument, rather than trusting an in-line schema comment alone.

## This pass's own conflict log

Every conflict this documentation pass found between a spec/prior doc and the real implementation — resolved or still open — is recorded in `technical/DOCUMENTATION_CONFLICTS.md`. No conflict identified during this pass was allowed to silently disappear; check that file before assuming a discrepancy is new.
