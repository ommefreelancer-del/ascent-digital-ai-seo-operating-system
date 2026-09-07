# Legacy Documentation (Version 1.0 — Superseded)

This folder contains the first-pass, flat-structure documentation set produced before the three-layer restructure (`client/`, `admin/`, `technical/`, `agents/`) described in `docs/README.md`. It is preserved here for historical reference and audit trail — **nothing was deleted**, per this project's standing rule against silently discarding existing documentation.

**Do not use these files as current reference material.** Every piece of still-accurate content from this folder was reviewed, re-verified against the codebase, and carried forward into the new structure below. Where this pass found the old content still correct, the new file says so; where it found a discrepancy, that discrepancy is recorded in `technical/DOCUMENTATION_CONFLICTS.md`, not silently dropped.

## Where each old file's content now lives

| Old file | Superseded by |
|---|---|
| `architecture/ARCHITECTURE.md` | `technical/ARCHITECTURE.md` |
| `architecture/BOSS_AGENT_AND_ROUTING.md` | `technical/BOSS_AGENT_AND_ROUTING.md` |
| `architecture/AGENT_COMMUNICATION.md` | `technical/AGENT_COMMUNICATION.md` |
| `architecture/DOCUMENTATION_CONFLICTS.md` | `technical/DOCUMENTATION_CONFLICTS.md` (all prior conflicts carried forward; several newly resolved in this pass) |
| `product/OVERVIEW.md` | `client/CLIENT_GUIDE.md` (client-facing) and the top of `docs/README.md` (general overview) |
| `user-guide/USER_GUIDE.md` | `client/GETTING_STARTED.md`, `client/FEATURES_AND_CAPABILITIES.md`, `client/WORKFLOW_GUIDE.md`, `client/APPROVALS_AND_HUMAN_CONTROL.md` |
| `admin/ADMIN_GUIDE.md` (original) | `admin/ADMIN_GUIDE.md` (rewritten in place, same path — this old copy exists only if retained from before the rewrite) |
| `admin/MASTER_CHANGE_MAP.md` (original) | `admin/MASTER_CHANGE_MAP.md` (rewritten in place to the required 11-column format) |
| `admin/SUBSCRIPTION_READINESS.md` (original) | `admin/SUBSCRIPTION_READINESS.md` (lightly updated in place, same path) |
| `configuration/ENVIRONMENT_VARIABLES.md` | `admin/SYSTEM_CONFIGURATION.md` |
| `database/DATA_MODEL.md` | `admin/DATA_AND_STORAGE.md` (summary) and `technical/DATABASE_REFERENCE.md` (full detail) |
| `security/SECURITY_AND_GOVERNANCE.md` | `admin/SECURITY_AND_GOVERNANCE.md` (operational summary) and `technical/SECURITY_ARCHITECTURE.md` + `technical/AUTH_AND_RBAC.md` (full technical detail) |
| `security/HUMAN_APPROVAL_SYSTEM.md` | Folded into `admin/SECURITY_AND_GOVERNANCE.md`, `client/APPROVALS_AND_HUMAN_CONTROL.md`, and `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md` |
| `security/LOGGING_AUDIT_AND_ERROR_HANDLING.md` | `technical/LOGGING_AND_AUDIT.md` and `technical/ERROR_HANDLING.md` |
| `testing/TESTING_AND_VALIDATION.md` | `admin/TESTING_AND_VALIDATION.md` (operational) and `technical/TESTING_REFERENCE.md` (developer detail) |
| `deployment/DEPLOYMENT_GUIDE.md` | `admin/DEPLOYMENT_OPERATIONS.md` (operational) and `technical/DEPLOYMENT_REFERENCE.md` (developer detail) |
| `change-management/CHANGE_MANAGEMENT_GUIDE.md` | `admin/AGENT_CONFIGURATION.md` and `admin/INTEGRATION_CONFIGURATION.md` (step-by-step procedures moved here); general checklist folded into `admin/MASTER_CHANGE_MAP.md` |
| `maintenance/MAINTENANCE_AND_DOC_SYNC.md` | `admin/MAINTENANCE_GUIDE.md` (operational tasks) and `admin/DOCUMENTATION_MAINTENANCE.md` (documentation-sync rules and the change-to-documentation matrix) |
| `troubleshooting/TROUBLESHOOTING.md` | `client/TROUBLESHOOTING.md` (client sections) and `admin/TROUBLESHOOTING.md` (admin sections) |
| `integrations/INTEGRATIONS_REFERENCE.md` | `technical/INTEGRATIONS_REFERENCE.md` (full detail) and `admin/INTEGRATION_CONFIGURATION.md` (operational) |
| `workflows/SEO_AUDIT_WORKFLOW.md`, `CONTENT_GENERATION_WORKFLOW.md`, `AUDIT_REMEDIATION_WORKFLOW.md`, `GUEST_POSTING_OUTREACH_WORKFLOW.md`, `REPORTING_WORKFLOW.md` | `technical/workflows/` (same filenames, same content location as of this pass — these were written directly into the new location and were not duplicated here) |

## A note on files the original README referenced but that do not exist in this documentation workspace

The version 1.0 `README.md` (preserved below as `_legacy-v1/README-v1-original.md` is **not** a separate file — the original `README.md` was overwritten in place at `docs/README.md`; its content is fully reproduced in the table above and in this pass's `README.md` history) referenced several files that were not found in this documentation workspace when this pass began: `architecture/ClientRelationshipManagementAgent.md`, `architecture/ConversationLanguageManager.md`, `architecture/GuestPostingDigitalPRAgent.md`, `architecture/VoiceInterface.md`, `docs/bing-webmaster-integration.md`, and `docs/governance/ENGINEERING_STANDARDS.md` / `DevelopmentWorkflow.md`. This pass could not verify, migrate, or preserve content that was not present to read — this is recorded here rather than silently assumed resolved. If these files exist elsewhere in the actual repository (outside this documentation workspace), they should be located and either migrated into the appropriate new-structure file or preserved in this legacy folder in a follow-up pass.

## Why this folder is kept rather than deleted

Per this project's explicit documentation-maintenance rule (`admin/DOCUMENTATION_MAINTENANCE.md`, rule 4): "Never delete or silently overwrite an existing hand-authored doc to resolve an apparent conflict with newer documentation." Retaining this folder as a clearly labeled historical archive satisfies both that rule and the quality requirement to avoid duplication in the *active* documentation set — a reader following `docs/README.md` will never be routed here, but the history is not lost.
