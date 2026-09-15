# Workflow: Reporting

Classification: **AUTOMATIC** (real report/deliverable generation from persisted data; no approval gate confirmed — reports are read-only artifacts, not production changes).

## Purpose

Assemble real, persisted data into a report and, optionally, a client-facing deliverable (PDF).

## Entry point / trigger

A user request for a report, or Client Reporting Agent's chat dispatch (see `agents/client-reporting-agent.md` for that agent's own execution-mode classification).

## Step sequence

1. Real data assembly — `web/src/server/backend/reporting.ts` contains real classes (a real `TechnicalSeoAgent` class and a real `WebsiteAuditAgent` class, distinct from their chat-dispatch counterparts) used specifically to assemble report content from real, already-persisted data.
2. `Report` row created (`type`: seo-performance/ai-usage/keyword-growth, `resultJson`).
3. Optionally, a `Deliverable` (PDF) is generated **from** the `Report` — never standalone. `reportId` is a required foreign key; a `Deliverable` never exists without a real, persisted source `Report`.
4. `Deliverable.status` starts `"generating"` and only becomes `"completed"` once the real file exists on disk — a `"failed"` row is an honest, permanent record, never silently upgraded to look successful (confirmed directly in the model's schema comment).

## Data passed between steps

The `Report.resultJson` snapshot is the sole input to deliverable generation — never re-derived from live data at PDF-generation time, so what's in the PDF is provably what the report said.

## Approval gates

None confirmed — generating a report or a PDF deliverable does not modify any external system.

## Integrations used

`pdfkit` (root dependency, confirmed in `web/package.json`) for real PDF generation.

## Outputs

A `Report` row; optionally a real PDF file referenced by a `Deliverable` row.

## Persistence / storage

`Report`, `Deliverable` (Prisma). `Deliverable.storagePath` is outside `public/` — retrieval requires an authenticated, ownership-checked download route, never a static URL. Optional link: `Deliverable.campaignRecordId` → `CampaignRecord`; deleting the campaign record sets this null rather than cascading.

## Error handling

A `Deliverable` that fails mid-generation is recorded `"failed"` with an `error` field — never presented as completed.

## Logging / audit behavior

Standard `ActivityEvent`/`AuditLogger` conventions apply; no report-specific audit event was independently confirmed beyond this.

## Completion criteria

`Deliverable.status === "completed"` and `fileSize` is a real, non-zero byte count.

## What happens when a step is unavailable

If the source `Report` data is incomplete, the report itself should reflect that honestly (per the codebase-wide anti-fabrication convention) rather than filling gaps — the exact per-field behavior was not independently traced in this pass.

## Exact implementation file(s)

`web/src/server/backend/reporting.ts`, `Report`/`Deliverable` in `web/prisma/schema.prisma`.

## Exact documentation file(s)

This file; `agents/client-reporting-agent.md`.
