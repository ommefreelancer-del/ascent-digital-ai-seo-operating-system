# Logging, Auditing & Error Handling

Audience: admin / developer.

## Two audit trails

1. **Root backend `AuditLogger`** — structured JSONL, written to files under `var/` (e.g. `var/web/boss-agent/audit-log.jsonl`, `var/web/conversation-language-manager/audit-log.jsonl`). Confirmed directly read by `admin-governance.ts`'s `inspectAuditLogFile()`, which parses each line as JSON, extracts an `eventType`, and reports file existence, size, last-modified time, and recent event types — treating a malformed line as real, disclosed evidence rather than silently dropping it.
2. **Web-layer `ActivityEvent`** (Prisma) — a per-user, queryable database log. Confirmed real category: `"authorization"` (logged on every RBAC denial by `rbac.ts`'s `assertAuthorized()`).

`BossAgent.run()` (root) logs `task_received` and `routing_decided` events for every task; `BossOrchestrator` additionally logs `orchestrator_started`/`orchestrator_stopped`.

## ChatMessage-level audit detail

Every assistant `ChatMessage` can carry `metaJson` — the real routing decision plus any escalations — surfaced in the UI's Task Progress / Execution Log detail view, giving a user (and an admin reviewing their account) a per-message audit trail without needing direct database or log-file access.

## Error-handling conventions (confirmed, pervasive, not a per-file accident)

- **Typed "not configured" errors** rather than silent fallback or fabrication: `AnthropicNotConfiguredError`, `CredentialEncryptionNotConfiguredError`. Confirmed pattern extends to every optional integration per `.env.example`'s own comments ("without it, X returns a clear 'not configured' error").
- **Fail-closed authorization:** an unknown/malformed role normalizes to the least-privileged `"viewer"`, never a default-allow.
- **Honest skip over fabrication:** a check that cannot run (e.g. Lighthouse not opted into, no safe Gmail read call) is reported as `NOT_TESTED`/`NOT_VERIFIED`/skipped — confirmed directly in `system-readiness.ts` (`CheckStatus = "PASS" | "FAIL" | "NOT_VERIFIED"`) and `integration-health-check.ts` (`"PASS" | "FAIL" | "NOT_TESTED" | "PENDING"`).
- **`safeCheck()` wrapper pattern** (`integration-health-check.ts`): every individual health check is wrapped so a thrown error anywhere (including the initial connection-status lookup) becomes that one check's own `FAIL` result — it can never reject the shared `Promise.all()` and take every other check down with it.
- **Never log credentials:** confirmed explicitly in `credential-encryption.ts`'s own header ("never logs... in an error message") and in `integration-health-check.ts`'s header ("No credentials, tokens, or secret values are ever included in any `detail` string... confirmed by inspection of every module called here").
- **Deliverable/report generation:** a `Deliverable` row starts `"generating"` and only becomes `"completed"` once the real file exists on disk — a `"failed"` row is an honest record, never silently upgraded.
- **GCM authentication tags:** `decryptSecret()` throws rather than ever returning corrupted or partial plaintext if a stored value was tampered with or the key is wrong.

## Production readiness self-check

`web/src/server/backend/system-readiness.ts` runs six real, read-only checks (Boss Agent routing, tool/resource access via a live GitHub API call, the Human Approval Gate's own lookup mechanism, a live negative-case tenant-isolation proof, end-to-end request flow, live server/build facts) and reports an honest `PRODUCTION_READY`/`NOT_PRODUCTION_READY` verdict — every check is a pure read, never a mock or simulated outcome, and none of them mutate production data.

## Where to modify

- Root audit logging: `AuditLogger` (`src/core/governance/`), its `var/` output paths configured via `BossAgentConfig.auditLogPath`.
- Web activity logging: `web/src/server/backend/log-activity.ts` (referenced by `rbac.ts`; confirm exact path before editing).
- Health-check error conventions: `web/src/server/backend/integration-health-check.ts`.
- Production-readiness checks: `web/src/server/backend/system-readiness.ts`.
