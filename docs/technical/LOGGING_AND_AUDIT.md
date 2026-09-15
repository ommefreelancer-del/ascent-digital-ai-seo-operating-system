# Logging & Audit

Audience: developer/engineer.

## Two audit trails

1. **Root backend `AuditLogger`** — structured JSONL under `var/` (e.g. `var/web/boss-agent/audit-log.jsonl`, `var/web/conversation-language-manager/audit-log.jsonl`). Confirmed read by `admin-governance.ts`'s `inspectAuditLogFile()`, which parses each line as JSON, extracts an `eventType`, and reports file existence/size/last-modified/recent event types — a malformed line is treated as real, disclosed evidence rather than silently dropped.
2. **Web-layer `ActivityEvent`** (Prisma) — a per-user, queryable database log. Confirmed category: `"authorization"` (every RBAC denial, `rbac.ts`'s `assertAuthorized()`).

`BossAgent.run()` logs `task_received`/`routing_decided` for every task; `BossOrchestrator` additionally logs `orchestrator_started`/`orchestrator_stopped`.

## ChatMessage-level detail

Every assistant `ChatMessage` can carry `metaJson` — the real routing decision plus escalations — surfaced in the UI's Task Progress / Execution Log detail view.

## Production readiness self-check

`web/src/server/backend/system-readiness.ts` runs six real, read-only checks: Boss Agent routing (uses the actual `RoutingDecision` that dispatched the request), tool/resource access (a live GitHub API call), the Human Approval Gate's own lookup mechanism, a live negative-case tenant-isolation proof, end-to-end request flow, and live server/build facts (`process.version`, `process.pid`, `process.uptime()`). Reports `PRODUCTION_READY`/`NOT_PRODUCTION_READY` — every check is a pure read, never a mock, and none mutate production data.

## Integration health checks

`web/src/server/backend/integration-health-check.ts` calls each integration's real, already-used functions directly (never through an LLM). `safeCheck()` wraps every individual check so one thrown error becomes that check's own `FAIL` result and can never take down the shared `Promise.all()`. No credential/token value is ever included in a `detail` string — confirmed by the module's own header, which states this was checked "by inspection of every module called here."

## Where to modify

- Root audit logging: `AuditLogger` (`src/core/governance/`), configured via `BossAgentConfig.auditLogPath`.
- Web activity logging: `web/src/server/log-activity.ts`.
- Health-check conventions: `web/src/server/backend/integration-health-check.ts`.
- Production-readiness checks: `web/src/server/backend/system-readiness.ts`.
