# Subscription / Multi-Tenant SaaS Readiness

Audience: owner. **This document exists specifically to prevent a false claim that ADASOS is already a ready-to-sell, multi-tenant SaaS product.** Every statement below is grounded directly in code and schema evidence gathered during this documentation pass (`rbac.ts`, `schema.prisma`, `db.ts`, `auth.ts`). See `admin/SECURITY_AND_GOVERNANCE.md` for the underlying auth/RBAC/isolation detail and `admin/DATA_AND_STORAGE.md` for the database architecture referenced below.

## Bottom line

**ADASOS today is a genuinely real, working single-operator product with strong per-account data isolation — it is NOT currently a multi-tenant SaaS platform with billing, plans, or team accounts.** Selling it to multiple independent paying customers today would mean giving each customer their own separate deployment (their own database file, their own `.env`, their own running process), not separate logins on one shared running instance in the way a typical SaaS product works.

## Already implemented (real, verified)

- **Per-account authentication:** real email/password accounts (`User` model, bcrypt-hashed passwords), NextAuth JWT sessions, production-hardened secret checks, rate-limited login.
- **Per-account data isolation:** every sensitive model (`Project`, `SeoAudit`, `GitHubConnection`, `WordPressConnection`, `GoogleSearchConsoleConnection`, `RemediationApproval`, `CampaignRecord`, etc.) is scoped by a `userId`/`ownerId`/`workspaceId` foreign key, enforced at the application query layer. `system-readiness.ts` includes a real, executed negative-case test proving a synthetic nonexistent workspace id genuinely retrieves zero rows through the same real lookup function.
- **A real, enforced (if minimal) authorization model:** two roles, `"owner"`/`"viewer"`, fail-closed, with logged denials.
- **Real credential encryption at rest**, confirmed for GitHub, Google Search Console, and WordPress connections (AES-256-GCM) — see `admin/SECURITY_AND_GOVERNANCE.md` for the full picture and one remaining stale in-code comment (recorded, not a functional gap).
- **A real, single-file SQLite database per deployment**, hardened for one process's concurrent request load.

## NOT implemented (recorded plainly, per explicit instruction not to overstate this)

- **No Organization/Team/Workspace-with-multiple-members model.** `rbac.ts`'s own header states this directly: "every User row already IS its own fully isolated tenant... no existing 'invite a teammate' flow anywhere in web/src (confirmed by grep)." One `User` row = one fully isolated account; there is no concept of multiple people sharing one account/workspace with different permissions on shared data.
- **No billing/subscription/plan system.** No Stripe (or other payment provider) integration, no plan/tier field on `User`, no usage metering or quota enforcement tied to a paid plan was found anywhere in this codebase during this pass.
- **No admin console for managing multiple customer accounts** from one operator view — beyond what Admin Agent's governance evidence provides (which is itself scoped to the *requesting* account only, never cross-tenant, by explicit design).
- **No self-service signup gating, invite flow, or account-provisioning automation** for onboarding new paying customers at scale.
- **Single-process, single-machine deployment** (SQLite, PM2 fork mode) — running many independent customers' data in one shared running instance is not how the system is currently architected; scaling to multiple simultaneous customers on shared infrastructure would require, at minimum, the Postgres migration `RUN_GUIDE.md` itself describes as a future, not-yet-done step.
- **`role` ("owner"/"viewer") is not a subscription tier.** It exists to let one account holder create a read-only login for someone else on the *same* account (e.g. a junior staff member, a client stakeholder) — it is explicitly documented in-code as *not* a sharing/permissions model between different customer accounts.

## What "already fully multi-tenant" would require (not built)

1. A real Organization/Team model with multiple `User` rows belonging to one billing entity, and a genuine invite flow.
2. A billing/subscription integration (plan tiers, payment processing, usage limits enforced in code).
3. Either (a) one shared running instance safely serving many independent paying customers' data (requiring the Postgres migration, connection scoping already exists at the data layer and would carry over), or (b) a provisioning system to stand up isolated per-customer deployments automatically.
4. An operator-facing admin console to manage customer accounts, plans, and support access across tenants — distinct from the current, per-account-only Admin Agent governance view.
5. Team-level RBAC (multiple real permission levels *within* one customer's team), as opposed to the current owner/viewer split on a single account.

## Recommended path if the owner wants to sell this to multiple SEO agencies/clients

This is offered as a recommendation, not a description of anything implemented: the fastest real path with the current architecture is **one isolated deployment per paying customer** (their own SQLite file, their own `.env`, their own process — the exact single-tenant architecture that already exists and is well-hardened) rather than building shared multi-tenant infrastructure first. This defers the Organization/billing/Postgres work until there is a concrete need for one running instance to serve many customers at once.
