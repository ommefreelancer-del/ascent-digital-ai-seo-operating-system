# Database Reference

Audience: developer/engineer. Explains purpose, ownership, and relationships of every model in `web/prisma/schema.prisma` (26 models). Read the schema directly for exact column types/full inline comments. **Engine: SQLite**, single-process, WAL-mode hardened (see `DEPLOYMENT_REFERENCE.md`).

## Ownership convention

Every sensitive model carries a `userId`/`ownerId`/`workspaceId` foreign key to `User`, `onDelete: Cascade`. No cross-account sharing mechanism exists — this is the entire client-isolation boundary, enforced by application-layer query filtering (every real lookup filters by the requesting session's own id), not a database-level row-security feature. See `AUTH_AND_RBAC.md` and `admin/SUBSCRIPTION_READINESS.md`.

## Models by area

**Identity & account:** `User` (role: `"owner"`/`"viewer"`, the sole enforced authorization field; profile/notification fields), `PasswordResetToken` (single-use, expiring).

**Projects & audits:** `Project`, `ProjectActivity`, `SeoAudit` (`resultJson` + summary counts).

**Content & keywords:** `SavedKeyword` (unique per `userId`+`keyword`), `ContentDraft`.

**Chat / workspace:** `ChatSession`, `ChatMessage` (`metaJson` carries routing decision + escalations; can reference an `Attachment`, `onDelete: SetNull`), `Attachment` (real uploaded file — xlsx/xls/csv/pdf/docx only; stored under a private root, retrieved only via an authenticated, ownership-checked route; original filename never used to derive the on-disk path; original upload never overwritten), `SpreadsheetCleaningApproval` (Google Sheets cleaning approval gate; per-tab write tracking prevents double-writes on retry; `write_failed` is a genuinely distinct, persisted state).

**Reporting & deliverables:** `Report` (`resultJson`), `Deliverable` (real generated artifact **from** a `Report`; `status` only `"completed"` once the real file exists on disk).

**Activity & governance:** `ActivityEvent` (includes real authorization-denial events, `category: "authorization"`).

**External connections** (one model per provider, deliberately never merged): `GoogleSearchConsoleConnection` (tokens AES-256-GCM encrypted — **confirmed**, `google-search-console.ts` imports `encryptSecret`/`decryptSecret`), `BingOAuthState` (short-lived CSRF/session bridge for Bing's cross-origin callback requirement), `BingWebmasterConnection` (deliberately separate from Google Search Console — different provider/scopes/verification), `GoogleServiceConnection` (generic foundation for Business Profile/Sheets/Gmail/Drive/Analytics — one row per `(userId, service)`), `WordPressConnection` (one per user, two independent providers in one model; tokens AES-256-GCM encrypted — **confirmed**, `wordpress.ts` imports `encryptSecret`/`decryptSecret`), `GitHubConnection` (the real repository-write credential; `repositoryFullName` a single, explicit least-privilege scope; `accessToken` AES-256-GCM encrypted).

**Prospecting/outreach:** `Prospect` (canonical structured record; Gmail is NOT the system of record — only thread/draft/message references stored), `CampaignRecord` (one row per `userId`+`campaignName`; `phase` never includes `"completed"`).

**Remediation & web-development change control:** `RemediationExecutionRecord` (one row per remediation that reached actual execution), `RemediationApproval` (bound to a `connectionId`, has a real `expiresAt`; can carry `status: "not_remediable"` with a 100-year `expiresAt` for a permanently out-of-scope finding — see `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md`), `WebDevelopmentChange` (analogous approval/change-control model for arbitrary whole-file website changes; deliberately separate from `RemediationApproval`).

## Encryption status — resolved

Both `WordPressConnection` and `GoogleSearchConsoleConnection` token fields are **confirmed encrypted** via `credential-encryption.ts`'s real `encryptSecret()`/`decryptSecret()` functions, by direct import-and-call-site verification in `wordpress.ts` and `google-search-console.ts`. `credential-encryption.ts`'s own header comment claiming these are stored in plaintext is stale and should be corrected (Engineering Follow-up — see `DOCUMENTATION_CONFLICTS.md` Resolved 2). `GoogleServiceConnection`'s tokens are documented in-schema as using the same mechanism — not independently re-verified by a call-site read in this pass.

## Full model list (26)

User, PasswordResetToken, Project, ProjectActivity, SeoAudit, SavedKeyword, ApiKey, ChatSession, ChatMessage, Attachment, SpreadsheetCleaningApproval, Report, Deliverable, ContentDraft, ActivityEvent, GoogleSearchConsoleConnection, BingOAuthState, BingWebmasterConnection, GoogleServiceConnection, Prospect, WordPressConnection, GitHubConnection, RemediationExecutionRecord, RemediationApproval, WebDevelopmentChange, CampaignRecord.

## Where to modify

- Schema: `web/prisma/schema.prisma`.
- Migrations: `npm run db:migrate:dev` (local) / `db:migrate:deploy` (production, manual step — see `DEPLOYMENT_REFERENCE.md`).
- A schema change requires a Prisma migration and, in most cases, a corresponding change to whichever `web/src/server/**` module reads/writes that model.
