# Security Architecture

Audience: developer/engineer. Covers isolation and encryption architecture. Authentication/RBAC mechanics are in `AUTH_AND_RBAC.md`; audit logging in `LOGGING_AND_AUDIT.md`.

## Client-data isolation

Enforced unconditionally, separately from role, via `userId`/`ownerId`/`workspaceId` foreign keys on every sensitive model (see `DATABASE_REFERENCE.md`). Every real lookup filters by the requesting session's own id — confirmed across `rbac.ts`, `admin-governance.ts`, `github.ts`'s connection lookups, and every Prisma query pattern observed (`db.<model>.findUnique({ where: { userId } })`). `system-readiness.ts` includes a live, executed negative-case isolation proof: a synthetic, nonexistent workspace id is checked to genuinely return zero rows through the same real, workspace-scoped lookup function real workspaces use.

## Credential encryption at rest

`web/src/server/credential-encryption.ts`: AES-256-GCM, key from `CREDENTIAL_ENCRYPTION_KEY` (32 bytes, hex or base64). Never logs plaintext or ciphertext in an error message. Decryption verifies the GCM auth tag — a tampered or wrong-key value throws rather than returning corrupted/partial data.

**Confirmed encrypted (call-site verified):** `GitHubConnection.encryptedAccessToken`, `WordPressConnection`'s app-password/access-token fields (`wordpress.ts` imports `encryptSecret`/`decryptSecret`), `GoogleSearchConsoleConnection`'s token fields (`google-search-console.ts`, same imports). `credential-encryption.ts`'s own header comment claiming WordPress/GSC are still plaintext is stale — see `DOCUMENTATION_CONFLICTS.md` Resolved 2 (recorded as an Engineering Follow-up to correct the comment).

**Not independently call-site-verified in this pass:** `GoogleServiceConnection`'s token fields (schema comment claims the same mechanism).

## Prompt-injection protections

Handled by the Conversation Language Manager (CLM) ahead of Boss Agent routing (`web/src/server/backend/conversation.ts`) — language detection, intent classification, and escalation on suspected prompt injection. Exact detection heuristics were not independently re-verified in this pass; see the pre-existing `docs/architecture/ConversationLanguageManager.md` for deeper detail.

## Anti-hallucination / anti-fabrication as a security-relevant convention

Pervasive, code-enforced pattern: a provider that isn't configured returns `null`/a typed error rather than fabricating a result; `limitations: readonly string[]` fields; honest "not connected"/"not found"/"not verifiable" states; a check that cannot run is reported as skipped, never guessed. Documented in full in `ERROR_HANDLING.md`. This matters for security because a fabricated "success" on a security-relevant check (isolation, authorization, encryption) would be a worse failure mode than an honest "could not verify."

## Least privilege

`GitHubConnection.repositoryFullName` scopes the remediation adapter to exactly one repository; `REMEDIATION_OPERATIONS` further scopes real writes to exactly three named resources (robots.txt, sitemap.xml, canonical link on index.html) — see `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md`.

## Where to modify

- Encryption: `web/src/server/credential-encryption.ts`.
- Isolation boundary: enforced per-query in every `web/src/server/**` module — there is no central enforcement point to modify; a new query must itself filter by the requesting session's id.
- CLM/prompt-injection: `web/src/server/backend/conversation.ts`.
