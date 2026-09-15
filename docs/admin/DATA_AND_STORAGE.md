# Data & Storage

Audience: admin. This is the operational summary of the database; for the full model-by-model reference see `technical/DATABASE_REFERENCE.md`. Engine: SQLite, single-process, WAL-mode + busy_timeout hardened (`web/src/server/db.ts`).

## Ownership convention

Every sensitive model carries a `userId` (or `ownerId`/`workspaceId`) foreign key to `User`, `onDelete: Cascade`. There is no cross-account sharing mechanism anywhere in this schema — this is the entire client-isolation boundary, enforced by query filtering at the application layer, not by a database-level row-security feature. See `admin/SECURITY_AND_GOVERNANCE.md` and `admin/SUBSCRIPTION_READINESS.md`.

## The 26 models, by area

| Area | Models |
|---|---|
| Identity & account | `User`, `PasswordResetToken` |
| Projects & audits | `Project`, `ProjectActivity`, `SeoAudit` |
| Content & keywords | `SavedKeyword`, `ContentDraft` |
| Chat / workspace | `ChatSession`, `ChatMessage`, `Attachment`, `SpreadsheetCleaningApproval` |
| Reporting & deliverables | `Report`, `Deliverable` |
| Activity & governance | `ActivityEvent` |
| External connections | `GoogleSearchConsoleConnection`, `BingOAuthState`, `BingWebmasterConnection`, `GoogleServiceConnection`, `WordPressConnection`, `GitHubConnection` |
| Prospecting / outreach | `Prospect`, `CampaignRecord` |
| Remediation & web-dev change control | `RemediationExecutionRecord`, `RemediationApproval`, `WebDevelopmentChange` |
| Other | `ApiKey` |

Full field-level detail (types, comments, relationships) lives in `web/prisma/schema.prisma` itself and in `technical/DATABASE_REFERENCE.md` — this document intentionally does not duplicate it.

## Backup

The single file of record is `web/prisma/prisma/dev.db` (note the doubled `prisma/prisma` path segment — a real, documented quirk: Prisma resolves a relative SQLite `DATABASE_URL` against `schema.prisma`'s own directory, not the project root). Because of WAL mode, recent writes can briefly live in a separate `-wal` file — run `PRAGMA wal_checkpoint(TRUNCATE);` before copying for a backup.

**No automated backup schedule exists as of this pass.** This is recorded explicitly (not as a defect to fix under this documentation-only pass, but as an operational gap worth closing before real client data accumulates). Until automated, periodically checkpoint WAL and copy the database file to off-machine storage.

## Schema changes

Schema changes go through real, versioned Prisma migrations:
- Development: `npm run db:migrate:dev` (from `web/`).
- Production: `npm run db:migrate:deploy` — a deliberate manual step run after pulling new code and before restarting the app, never auto-applied during build.
- `npm run db:migrate:status` checks for pending migrations without applying them.

**Never use `prisma db push` in a repository that already has migration history** — the pre-commit hook and CI's startup-validation step both assume a real migration trail exists.

## Scaling beyond SQLite

SQLite is a deliberate choice matching the current single-process, single-machine deployment — see `admin/DEPLOYMENT_OPERATIONS.md`. Moving to Postgres is real infrastructure work, not a config toggle: it requires provisioning a real, separately-hosted Postgres instance, changing `schema.prisma`'s `datasource db.provider` from `sqlite` to `postgresql`, setting a new `DATABASE_URL`, and a full regression pass plus a real backup/restore rehearsal before cutting over. This is explicitly described in the repository's own operational documentation as a future, not-yet-done step — see `admin/MASTER_CHANGE_MAP.md`'s Database group.

## Where to modify

- Schema: `web/prisma/schema.prisma`.
- Migration workflow: `web/package.json`'s `db:migrate:*` scripts; see `admin/DEPLOYMENT_OPERATIONS.md`.
- A schema change requires a Prisma migration and, in most cases, a corresponding change to whichever `web/src/server/**` module reads/writes that model.
