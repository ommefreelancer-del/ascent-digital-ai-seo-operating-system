# ADASOS / SM Digital — Documentation

This is the complete, verified documentation set for the Ascent Digital AI SEO Operating System (ADASOS), operated commercially as SM Digital. Every claim in this documentation is grounded directly in the current codebase; anything that could not be confirmed is explicitly labeled **NOT VERIFIED IN CURRENT CODEBASE** rather than guessed. Discovered inconsistencies between documents, or between documentation and code, are recorded in `technical/DOCUMENTATION_CONFLICTS.md`, never silently resolved.

The documentation is organized into three layers, by audience:

- **`client/`** — for the end-user/subscriber using the chat workspace. No internal file paths, class names, database details, API implementation, or credentials appear here — only what a client needs to use the product effectively.
- **`admin/`** — for the system owner/administrator. Configuration, security posture, deployment operations, and the master "where do I change X" lookup.
- **`technical/`** — for a developer/engineer. Full architecture, exact code paths, database schema, and the complete agent/workflow/integration reference.

**`agents/`** sits alongside these three layers and is referenced by all of them: one file per specialist, plus an index.

## Tell me who you are

| I am... | Start here |
|---|---|
| **A CLIENT** using the chat workspace | [`client/CLIENT_GUIDE.md`](client/CLIENT_GUIDE.md) |
| **THE SYSTEM OWNER / ADMIN** | [`admin/ADMIN_GUIDE.md`](admin/ADMIN_GUIDE.md) |
| **A DEVELOPER / ENGINEER** | [`technical/ARCHITECTURE.md`](technical/ARCHITECTURE.md) |
| Someone who needs to **UNDERSTAND AN AGENT** | [`agents/INDEX.md`](agents/INDEX.md) |
| Someone who needs to **CHANGE SOMETHING** | [`admin/MASTER_CHANGE_MAP.md`](admin/MASTER_CHANGE_MAP.md) — the single most important reference in this set |
| Someone who needs to **TROUBLESHOOT SOMETHING** | [`client/TROUBLESHOOTING.md`](client/TROUBLESHOOTING.md) (client-facing) or [`admin/TROUBLESHOOTING.md`](admin/TROUBLESHOOTING.md) (technical) |
| Someone who needs to **DEPLOY** | [`admin/DEPLOYMENT_OPERATIONS.md`](admin/DEPLOYMENT_OPERATIONS.md) |
| Someone who needs to **UNDERSTAND SUBSCRIPTION READINESS** | [`admin/SUBSCRIPTION_READINESS.md`](admin/SUBSCRIPTION_READINESS.md) |

## Documentation versioning

| Field | Value |
|---|---|
| Documentation version | 2.0 (three-layer restructure) |
| Supersedes | Version 1.0 (the flat, single-layer documentation pass — files preserved under `docs/_legacy-v1/`, see note below) |
| Last verified against repository | 2026-09-06 — the commit that finalized this documentation set (`docs: finalize three-layer system documentation`, commit `1272cba9`); every claim herein was checked directly against source code as of that pass, not carried forward from assumption |
| Repository/implementation state covered | Root backend (`adasos-boss-agent`, frozen Boss Agent routing engine) + `web/` (`adasos-web` v2.0.0, the real Next.js 15/React 19 product) |
| Overall status | **PARTIALLY VERIFIED** — the large majority of claims are directly confirmed by code read (grep/read of the exact function or config referenced); a smaller number of items are explicitly labeled `NOT VERIFIED IN CURRENT CODEBASE` throughout, most of which are also indexed in `technical/DOCUMENTATION_CONFLICTS.md` |
| Major known limitations | (1) Not a multi-tenant SaaS product today — see `admin/SUBSCRIPTION_READINESS.md`. (2) Current deployment is a single-machine, single-process local Windows setup, not a hosted production deployment — see `admin/DEPLOYMENT_OPERATIONS.md`. (3) Several agents' real integrations are not confirmed wired into their own chat dispatch — see `agents/INDEX.md`'s "Split / dual-path" and "Role-play" groups. (4) No automated database backup exists yet — see `admin/DATA_AND_STORAGE.md`. |

There is no invented software version number here beyond the documentation set's own version — `web/`'s real `package.json` version (`adasos-web` v2.0.0) is cited directly where relevant instead of inventing a separate product version.

## Full index

### Client documentation (`client/`)

| File | Purpose |
|---|---|
| `CLIENT_GUIDE.md` | Entry point and navigation for client users |
| `GETTING_STARTED.md` | First-session walkthrough |
| `FEATURES_AND_CAPABILITIES.md` | What's real/data-backed vs. expert guidance |
| `AGENT_GUIDE.md` | Client-facing description of all 27 specialists |
| `WORKFLOW_GUIDE.md` | What happens step by step for multi-step requests |
| `APPROVALS_AND_HUMAN_CONTROL.md` | How the approval system works from a client's perspective |
| `INPUTS_AND_OUTPUTS.md` | What to provide and what you'll get back, per capability |
| `TROUBLESHOOTING.md` | Client-facing problem-solving |
| `FAQ.md` | Quick answers to common questions |

### Admin documentation (`admin/`)

| File | Purpose |
|---|---|
| `ADMIN_GUIDE.md` | Entry point and navigation for admins |
| `MASTER_CHANGE_MAP.md` | **The most important reference document in this set** — where to change any specific behavior, with exact paths, testing, deployment, migration, and approval requirements |
| `SYSTEM_CONFIGURATION.md` | Every environment variable and global/routing configuration setting |
| `AGENT_CONFIGURATION.md` | Adding, removing, and configuring agents |
| `WORKFLOW_CONFIGURATION.md` | Configuring the real automated workflows/pipelines |
| `INTEGRATION_CONFIGURATION.md` | Setting up and checking third-party integrations |
| `SECURITY_AND_GOVERNANCE.md` | Auth, RBAC, encryption, approval gates, isolation (operational summary) |
| `DATA_AND_STORAGE.md` | Database, backups, and the data model at a glance |
| `DEPLOYMENT_OPERATIONS.md` | Running, restarting, and monitoring the deployed app |
| `TESTING_AND_VALIDATION.md` | Running tests and health checks before trusting a change |
| `TROUBLESHOOTING.md` | Admin-level diagnosis of common problems |
| `MAINTENANCE_GUIDE.md` | Routine operational maintenance tasks |
| `DOCUMENTATION_MAINTENANCE.md` | Keeping this documentation set accurate as code changes |
| `SUBSCRIPTION_READINESS.md` | Honest, evidence-based assessment of multi-tenant/SaaS readiness |

### Technical documentation (`technical/`)

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | Full system architecture, the two-codebase model |
| `SYSTEM_COMPONENTS.md` | Major components and how they fit together |
| `BOSS_AGENT_AND_ROUTING.md` | The deterministic routing engine internals |
| `AGENT_ARCHITECTURE.md` | Why real, context-fed, and role-play agents coexist by design |
| `AGENT_COMMUNICATION.md` | How agents actually pass data to each other (and don't) |
| `WORKFLOW_ARCHITECTURE.md` | The classification system (AUTOMATIC / HUMAN APPROVAL REQUIRED / RECOMMENDATION ONLY / NOT CURRENTLY IMPLEMENTED) and index into `technical/workflows/` |
| `workflows/SEO_AUDIT_WORKFLOW.md`, `CONTENT_GENERATION_WORKFLOW.md`, `AUDIT_REMEDIATION_WORKFLOW.md`, `GUEST_POSTING_OUTREACH_WORKFLOW.md`, `REPORTING_WORKFLOW.md` | Full step-by-step documentation of each real workflow |
| `INTEGRATIONS_REFERENCE.md` | Every real/partial/not-verified external integration, exact source files |
| `CONFIGURATION_REFERENCE.md` | Developer-facing configuration reference |
| `DATABASE_REFERENCE.md` | All 26 Prisma models explained |
| `SECURITY_ARCHITECTURE.md` | Full security architecture |
| `AUTH_AND_RBAC.md` | Authentication and authorization internals |
| `LOGGING_AND_AUDIT.md` | Audit trail and logging architecture |
| `TESTING_REFERENCE.md` | Developer-facing testing/CI reference |
| `DEPLOYMENT_REFERENCE.md` | Developer-facing deployment reference |
| `ERROR_HANDLING.md` | Error-handling conventions |
| `EXTENSION_GUIDE.md` | How to extend the system (new agents, integrations, workflows) |
| `KNOWN_LIMITATIONS.md` | System-wide known limitations, consolidated |
| `DOCUMENTATION_CONFLICTS.md` | Every conflict found between spec/prior docs and real implementation — resolved or still open; nothing here silently disappears |

### Agent documentation (`agents/`)

- [`agents/INDEX.md`](agents/INDEX.md) — master table of all 27 specialists with execution-mode classification.
- `agents/<agent-id>.md` — one 25-field deep-dive file per agent, covering identity, mission, inputs/outputs, real vs. role-play execution mode, approval requirements, security, known limitations, and exactly where to modify its behavior.

## Documentation principles used throughout this set

1. Every factual claim is traceable to a specific file/code location.
2. Anything not directly confirmed is labeled `NOT VERIFIED IN CURRENT CODEBASE` rather than inferred confidently.
3. No existing documentation was deleted or silently overwritten — conflicts are recorded in `technical/DOCUMENTATION_CONFLICTS.md`, never hidden.
4. Real code defects discovered while documenting were recorded as findings, never fixed automatically as part of this documentation effort — see `technical/DOCUMENTATION_CONFLICTS.md`'s Engineering Follow-ups.
5. Client-facing documentation never exposes internal file paths, class names, database internals, API implementation detail, internal routing algorithms, secrets, or credentials.
6. No environment variable's real value ever appears in this documentation set — variable names only.
7. The system is never described as more "real," "automated," or "SaaS-ready" than the code currently supports.

## About the superseded (version 1.0) documentation

This is the second, more advanced documentation pass over this repository. The first pass produced a flatter, single-layer documentation set (`docs/architecture/`, `docs/admin/` in its earlier form, `docs/security/`, `docs/database/`, `docs/configuration/`, `docs/deployment/`, `docs/integrations/`, `docs/testing/`, `docs/troubleshooting/`, `docs/maintenance/`, `docs/change-management/`, `docs/product/`, `docs/user-guide/`, `docs/workflows/`). That content has been fully reviewed, verified, reorganized, and — in every case where it was still accurate — carried forward into this three-layer structure (`client/`, `admin/`, `technical/`, `agents/`). Nothing was silently discarded: see `docs/_legacy-v1/README.md` for exactly what was superseded, by which new file, and why the old flat folders are retained as a historical record rather than deleted.
