# Security & Governance

Audience: admin / owner. Full evidence sources: `web/src/server/rbac.ts`, `rate-limit.ts`, `credential-encryption.ts`, `auth.ts`, `admin-governance.ts` (all fully read).

## Authentication

- NextAuth, JWT session strategy (`maxAge: 30 days`), `CredentialsProvider` only (email + bcrypt password hash) — confirmed as the sole registered provider in `auth.ts`. See `docs/architecture/DOCUMENTATION_CONFLICTS.md` Conflict 7 for an unresolved discrepancy around `GOOGLE_CLIENT_ID`/`SECRET`.
- **Production secret hardening:** at module load, if `NODE_ENV=production`, the app throws (refuses to start) if `NEXTAUTH_SECRET` is unset, matches a known placeholder value, or is shorter than 32 characters. This is explicitly documented in-code as defense-in-depth alongside `scripts/validate-startup.mjs`'s build-time check, covering the case where a built image is started directly via `next start` without going through `npm`'s script chain.
- **Login rate limiting:** in-memory, single-instance (`rate-limit.ts`) — 10 attempts per 15 minutes per `ip:email` key, enforced in `auth.ts`'s `authorize()`. The module's own comment states a multi-instance deployment needs a shared store (e.g. Redis/Upstash) instead — this is a real, documented scaling limitation, not a defect at current scale.

## Authorization (RBAC)

- Exactly two roles: `"owner"` (schema default — full access) and `"viewer"` (read-only). No separate Role/Permission table exists — `User.role` is the sole enforced field.
- `assertAuthorized(userId, capability)` gates exactly one real decision point in the entire system: approving or rejecting a `RemediationApproval`. Every other feature in the product is unaffected by role.
- **Fail closed:** an unknown or malformed role value (the schema column is a plain `String`, not a DB-level enum/CHECK constraint) normalizes to `"viewer"` — the least-privileged role — never to `"owner"`.
- Every denial is logged as a real `ActivityEvent` (`category: "authorization"`) — denials are never silent.
- **This is explicitly NOT a multi-tenant sharing model.** `rbac.ts`'s own header states there is no Organization/Team/Workspace-with-multiple-members concept anywhere in this codebase, confirmed by a direct grep for invite/team-member/organization/workspace-member/seat terminology (only unrelated hits: the user's own company-name field, GitHub's own account-type terminology). `role` is a capability level for what one account may do to its own data (e.g. a read-only stakeholder login using the same account), never a cross-account permission-sharing system. See `docs/admin/SUBSCRIPTION_READINESS.md`.

## Client-data isolation

Enforced unconditionally, separately from role, via `userId`/`ownerId`/`workspaceId` foreign keys on every sensitive model (see `docs/database/DATA_MODEL.md`). Every real lookup in the codebase filters by the requesting session's own id — confirmed directly in code across `rbac.ts`, `admin-governance.ts`, `github.ts`'s connection lookups, and every Prisma query pattern observed in this pass (`db.<model>.findUnique({ where: { userId } })`). `system-readiness.ts` includes a live, negative-case isolation proof: a synthetic, definitely-nonexistent workspace id is checked to genuinely return zero approvals through the same real, workspace-scoped lookup function real workspaces use — not a claim, an executed check.

## Credential encryption at rest

- `web/src/server/credential-encryption.ts`: AES-256-GCM, via `CREDENTIAL_ENCRYPTION_KEY` (32-byte key, hex or base64). Never logs plaintext or ciphertext in an error message. Decryption verifies the GCM auth tag — a tampered or wrong-key value throws rather than returning corrupted/partial data.
- **Confirmed encrypted:** `GitHubConnection.encryptedAccessToken`, `GoogleSearchConsoleConnection`'s tokens, `BingWebmasterConnection`'s tokens, `GoogleServiceConnection`'s tokens, `WordPressConnection`'s app password / access token fields (per schema comments referencing the same mechanism).
- **Known, disclosed gap (recorded, not fixed):** per `credential-encryption.ts`'s own header comment, this mechanism was introduced specifically for `GitHubConnection` because a repository-write credential is higher-stakes; it explicitly states this "does not retroactively fix" any pre-existing plaintext storage on other connection types, calling that "a real, pre-existing gap... out of this task's scope." **NOT VERIFIED IN CURRENT CODEBASE** whether WordPress/Google Search Console token fields are, as of the current schema, actually encrypted (the schema's own newer comments claim they now use the same mechanism) or still plaintext as this historical comment describes — the schema comments and this file's header comment appear to disagree in vintage. Confirm the actual current state of each token field directly before making a security claim to a client.

## Governance evidence for Admin Agent

`admin-governance.ts` assembles real, live, self-scoped (never cross-tenant) governance evidence — user access, RBAC state, client-isolation description, approval-control counts, and real audit-log-file inspection (`var/web/boss-agent/audit-log.jsonl`, `var/web/conversation-language-manager/audit-log.jsonl`) — and feeds it to Admin Agent's prompt so governance/security questions are answered from real numbers, never fabricated. Where the schema genuinely has no granular RBAC model, the evidence states that honestly rather than describing a permission system that doesn't exist.

## Where to modify

- Roles/capabilities: `web/src/server/rbac.ts`.
- Rate limiting: `web/src/server/rate-limit.ts`.
- Encryption: `web/src/server/credential-encryption.ts`.
- Production secret checks: `web/src/server/auth.ts` (top-of-file guard).
- Governance evidence assembly: `web/src/server/backend/admin-governance.ts`.
