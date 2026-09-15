# Reporting Workflow

Audience: admin / developer.

## Real components confirmed

- `web/src/server/backend/reporting.ts` — contains real classes/functions used for report generation, including a real `TechnicalSeoAgent` class (distinct from the chat-dispatch path) and a real `WebsiteAuditAgent` class, both used specifically to assemble report content from real data.
- `Report` (Prisma model) — `type`: `seo-performance` | `ai-usage` | `keyword-growth`; `resultJson` holds the real assembled report data.
- `Deliverable` (Prisma model) — a real, generated client-facing artifact (PDF today) produced **from** an already-persisted `Report`, never generated standalone. Schema comments are explicit: "deliverables must only be generated from REAL persisted data," `reportId` is a required foreign key (a Deliverable never exists without a real source Report), and `status` starts `"generating"` and only becomes `"completed"` once the real file has actually been written to disk — a `"failed"` row is an honest record of an unsuccessful attempt, never silently upgraded to look successful.
- Storage: `Deliverable.storagePath` is outside `public/` (never directly web-servable); retrieval requires an authenticated, ownership-checked download route.
- Optional link: `Deliverable.campaignRecordId` connects a deliverable back to a `CampaignRecord` (guest-posting/outreach campaign) when applicable; deleting the campaign record sets this null rather than cascading, since the deliverable's own content and source report remain valid independently.

## Client Reporting Agent

See `docs/agents/client-reporting-agent.md` for the specific agent's execution-mode classification. This workflow doc describes the underlying real report/deliverable machinery that agent's real dispatch (if any) would use.

## Where to modify

- Report generation logic: `web/src/server/backend/reporting.ts`.
- Data models: `Report`, `Deliverable` in `web/prisma/schema.prisma`.
- PDF rendering convention: referenced in schema comments as following the existing `server/pixabay.ts` `downloadAndStoreAsset()` pattern for storing a generated binary outside `public/` — confirm current PDF-generation library/path directly in `reporting.ts` before modifying.
