# Data Model

Audience: admin / developer. This document explains the purpose, ownership, and relationships of every model in `web/prisma/schema.prisma` (26 models) — it does not duplicate field-by-field detail already in the schema's own extensive inline comments; read `schema.prisma` directly for exact column types and full comments. **Engine: SQLite** (see `docs/architecture/ARCHITECTURE.md` §6 and `docs/deployment/DEPLOYMENT_GUIDE.md` for the single-process/WAL-mode implications).

## Ownership convention

Every sensitive model carries a `userId` (or `ownerId`/`workspaceId`) foreign key to `User`, `onDelete: Cascade`. There is no cross-account sharing mechanism anywhere in this schema — this is the entire client-isolation boundary, enforced by query filtering at the application layer (every real lookup in the codebase filters by the requesting session's own id), not by a database-level row-security feature. See `docs/security/SECURITY_AND_GOVERNANCE.md` and `docs/admin/SUBSCRIPTION_READINESS.md`.

## Models by area

### Identity & account
- **User** — the core account row. `role` (`"owner"` default, or `"viewer"`) is the sole real, enforced authorization field (`rbac.ts`). Also carries profile/notification preference fields (`theme`, `emailNotifications`, `productUpdates`, `weeklyDigest`).
- **PasswordResetToken** — single-use, expiring, opaque token → `userId`.

### Projects & audits
- **Project** — a client/site grouping (`name`, `domain`, `niche`, `status`). Owned by one `User`.
- **ProjectActivity** — a timestamped activity feed entry scoped to one project.
- **SeoAudit** — one real audit run's full result (`resultJson`) plus summary counts (`criticalCount`/`warningCount`/`infoCount`). Optionally linked to a `Project`.

### Content & keywords
- **SavedKeyword** — a user's saved keyword + intent classification + rationale. Unique per `(userId, keyword)`.
- **ContentDraft** — real generated content (`type`: blog/landing-page/meta/social), full result as `resultJson`.

### Chat / workspace
- **ChatSession** — one conversation thread.
- **ChatMessage** — one turn. `role` (user/assistant), `agentId`, `status` (assigned/escalated/rejected), `metaJson` (routing decision + escalations, for the Task Progress / Execution Log UI). Can reference an `Attachment` (`onDelete: SetNull` — deleting an attachment, which per its own model header never actually happens once linked, would not cascade into deleting real chat history).
- **Attachment** — a real user-uploaded file (xlsx/xls/csv/pdf/docx only — unsupported types rejected before a row is created). Stored under a private server-side root, retrieved only via an authenticated, ownership-checked route — never a static URL, and the original filename is never used to derive the on-disk path (path-traversal safety). The original upload is never overwritten once written.
- **SpreadsheetCleaningApproval** — the human-approval gate for the Google Sheets spreadsheet-cleaning capability. Mirrors `RemediationApproval`'s shape but is a dedicated model since that one's fields are GitHub-remediation-specific. Tracks per-tab write completion (`adminVendorWrittenAt`/`clientWebsitesWrittenAt`) so a retry after a partial failure never double-writes a tab that already succeeded. `status` includes a genuinely distinct `write_failed` state (only set after a real failed write attempt, never inferred).

### Reporting & deliverables
- **Report** — a generated report (`type`: seo-performance/ai-usage/keyword-growth), full result as `resultJson`.
- **Deliverable** — a real, generated client-facing artifact (PDF today) produced **from** a `Report` (`reportId` required). `status` (`generating`→`completed`/`failed`) only becomes `completed` once the real file exists on disk. Optionally linked to a `CampaignRecord`.

### Activity & governance
- **ActivityEvent** — a generic per-user activity/audit log row (`category`, `message`) — includes real authorization-denial events (`category: "authorization"`), read back by `admin-governance.ts`.

### External connections (one model per provider, deliberately never merged)
- **GoogleSearchConsoleConnection** — one per user (`userId @unique`). Tokens AES-256-GCM encrypted. `selectedSiteUrl` auto-picked and cached.
- **BingOAuthState** — a short-lived, single-use CSRF/session-bridge token, needed specifically because Bing's OAuth registration rejects `localhost` redirects, forcing a cross-origin callback flow in local dev where cookies don't survive. Mirrors `PasswordResetToken`'s shape.
- **BingWebmasterConnection** — one per user. Deliberately separate from Google Search Console: different provider, different scopes, different site-verification model — "keeping every provider's connection in its own model is what makes 'never merge different provider metrics in a way that makes the source ambiguous' enforceable at the schema level."
- **GoogleServiceConnection** — a generic foundation for every OTHER Google service (Business Profile, Sheets, Gmail, Drive, Analytics) beyond Search Console. One row per `(userId, service)` pair (unique constraint) — a user can hold independent connections to multiple Google services simultaneously. `metadataJson` carries service-specific selected-resource state (e.g. a chosen spreadsheet id) as a JSON string, validated in application code, not by the database.
- **WordPressConnection** — one per user, supporting two independent providers (self-hosted Application Passwords, or wordpress-com OAuth2) in one model, since both ultimately talk to the same `wp/v2`-shaped REST surface.
- **GitHubConnection** — one per user. The real "hands" credential for repository-write remediation. `repositoryFullName` is a single, explicit least-privilege scope; nullable to support a two-step connect-then-select-repo flow (`status: "pending_repository_selection"`). `accessToken` AES-256-GCM encrypted.

### Prospecting / outreach
- **Prospect** — the canonical structured record for a prospect/client. Gmail is deliberately NOT the system of record — only thread/draft/message *references* are stored; real email content is always fetched live. `qualificationStatus`, `outreachStatus` track pipeline state. Unique per `(userId, domain)`.
- **CampaignRecord** — one row per `(userId, campaignName)`, updated (never duplicated) on re-tracking. `phase` deliberately never includes `"completed"` — the real agent has no data source to justify claiming a campaign finished. Full real result snapshot in `resultJson`.

### Remediation & web-development change control
- **RemediationExecutionRecord** — one row per remediation that reached actual execution (never created for a task that stopped at BLOCKED/REJECTED). Full audit trail of the real change (`commitReference`, `deploymentReference`, `verificationReference`, `rollbackReference`).
- **RemediationApproval** — the real, persisted human-approval bridge. Bound to a specific `connectionId` (re-validated at decision) and `taskId` (unique, non-replayable). Has a real `expiresAt`.
- **WebDevelopmentChange** — the analogous approval/change-control model for the Web Development Agent's real website-change pipeline. Deliberately separate from `RemediationApproval` (different scope: arbitrary whole-file website changes vs. narrow, hard-scoped remediation operations). `filesJson` carries every proposed file's real previous content+sha and the real drafted new content.

## Full model list (26)

User, PasswordResetToken, Project, ProjectActivity, SeoAudit, SavedKeyword, ApiKey, ChatSession, ChatMessage, Attachment, SpreadsheetCleaningApproval, Report, Deliverable, ContentDraft, ActivityEvent, GoogleSearchConsoleConnection, BingOAuthState, BingWebmasterConnection, GoogleServiceConnection, Prospect, WordPressConnection, GitHubConnection, RemediationExecutionRecord, RemediationApproval, WebDevelopmentChange, CampaignRecord.

## Where to modify

- Schema: `web/prisma/schema.prisma`.
- Migration workflow: see `RUN_GUIDE.md`'s Prisma migration commands and `docs/deployment/DEPLOYMENT_GUIDE.md`.
- A schema change requires a Prisma migration (`prisma migrate dev`/`deploy`) and, in most cases, a corresponding change to whichever `web/src/server/**` module reads/writes that model.
