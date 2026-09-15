# Workflow Architecture

Audience: developer/engineer. This is the index and shared classification legend for every real workflow discovered in the repository. Full per-workflow detail (step sequence, data passed, approval gates, exact files) lives in `technical/workflows/`.

## Classification legend (used consistently across every workflow doc)

- **AUTOMATIC** — runs without any human decision point; may still be read-only or may make a real change without approval (rare — only diagnostic/read-only workflows in this system run fully automatically end-to-end).
- **HUMAN APPROVAL REQUIRED** — a real, production-affecting step is gated behind an explicit, persisted human decision; the workflow cannot complete that step without it.
- **RECOMMENDATION ONLY** — the workflow (or one of its stages) produces advisory text/output with no real-world side effect, regardless of how confidently it's phrased.
- **NOT CURRENTLY IMPLEMENTED** — described in a spec or architecture doc but no confirmed real, wired code path exists.

## Workflows documented

| Workflow | Overall classification | Detail file |
|---|---|---|
| SEO Audit | AUTOMATIC (diagnostic, read-only) | `technical/workflows/SEO_AUDIT_WORKFLOW.md` |
| Content Generation | Mixed — 2 of 5 stages AUTOMATIC/real, 3 of 5 RECOMMENDATION ONLY | `technical/workflows/CONTENT_GENERATION_WORKFLOW.md` |
| Technical Remediation | HUMAN APPROVAL REQUIRED (for the execute step) | `technical/workflows/AUDIT_REMEDIATION_WORKFLOW.md` |
| Guest Posting & Outreach | Mixed — RECOMMENDATION ONLY for most stages; real, persisted tracking for Prospecting/Campaign Tracking; sending is never automatic (human-only, by policy) | `technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md` |
| Reporting | AUTOMATIC (real report/deliverable generation, no approval gate confirmed) | `technical/workflows/REPORTING_WORKFLOW.md` |
| Web Development Change | HUMAN APPROVAL REQUIRED (for the apply/commit step) | See `AUDIT_REMEDIATION_WORKFLOW.md`'s sibling coverage and `agents/web-development-agent.md` |

## Never imply a recommendation-only flow performed a real action

Multiple stages across these workflows are Claude-authored narration with no tool execution behind them (see each workflow's stage table). A reply describing "I've done X" for a RECOMMENDATION ONLY stage must be read as a description of what the specialist recommends, not a confirmed action — this is stated in `client/APPROVALS_AND_HUMAN_CONTROL.md` for end-users and repeated here for engineers extending these pipelines: **do not remove the honest role-play/context-fed labeling when refactoring, and do not let a UI change imply a recommendation became an action without also wiring the real execution.**

## Where to modify

Each `technical/workflows/*.md` file lists its own exact implementation file(s). For adding a new workflow, see `technical/EXTENSION_GUIDE.md`.
