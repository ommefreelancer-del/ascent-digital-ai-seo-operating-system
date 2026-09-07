# Error Handling

Audience: developer/engineer.

## Confirmed, pervasive conventions (not a per-file accident)

- **Typed "not configured" errors** rather than silent fallback or fabrication: `AnthropicNotConfiguredError`, `CredentialEncryptionNotConfiguredError`, `WordPressNotConfiguredError`. Extends to every optional integration per `.env.example`'s own comments ("without it, X returns a clear 'not configured' error").
- **Fail-closed authorization:** an unknown/malformed role normalizes to `"viewer"`, never default-allow.
- **Honest skip over fabrication:** a check that cannot run is reported as `NOT_TESTED`/`NOT_VERIFIED`/skipped — confirmed in `system-readiness.ts` (`"PASS" | "FAIL" | "NOT_VERIFIED"`) and `integration-health-check.ts` (`"PASS" | "FAIL" | "NOT_TESTED" | "PENDING"`).
- **`safeCheck()` wrapper pattern:** every individual health check is wrapped so a thrown error anywhere becomes that check's own `FAIL` result, never a rejection that takes down the shared `Promise.all()`.
- **Never log credentials:** confirmed in `credential-encryption.ts`'s header and `integration-health-check.ts`'s header ("No credentials, tokens, or secret values are ever included in any `detail` string... confirmed by inspection of every module called here").
- **Deliverable/report generation:** starts `"generating"`, only becomes `"completed"` once the real file exists — `"failed"` is honest, never silently upgraded.
- **GCM auth tags:** `decryptSecret()` throws rather than returning corrupted/partial plaintext on tamper or wrong key.
- **Remediation scope enforcement:** an out-of-scope resource is rejected with an explicit `NOT_REMEDIABLE` result and a permanent (`100`-year `expiresAt`) recorded row — never silently attempted or silently dropped.
- **API-route error surfacing:** confirmed in `web/src/app/api/seo-audit/route.ts` — a crawl failure distinguishes an expected case (HTTP 422, message shown verbatim) from an unexpected one (HTTP 502, logged server-side, generic client message) rather than exposing raw internals or hiding all failures uniformly.

## Where this pattern must be preserved

Any new integration, agent, or workflow added to this system should follow the same convention: an unconfigured/unavailable capability returns an honest, typed "not configured"/"not available" state, never a mocked or fabricated result. See `EXTENSION_GUIDE.md`.

## Where to modify

There is no single central error-handling module — this is a convention enforced per-module. When reviewing a new module for consistency, check for: a typed error class for "not configured," an honest status enum (never a boolean `success` that can't represent "unknown"), and no credential values in any thrown message or logged detail.
