# Integration Configuration

Audience: admin. For the exhaustive technical status of every integration (auth mechanism, connection model, source files), see `technical/INTEGRATIONS_REFERENCE.md`. This document is the admin-facing "how do I set one up / check it / add a new one" guide. **Never place a real secret value in documentation — variable names only**, and see `admin/SYSTEM_CONFIGURATION.md` for the full environment-variable list.

## Setting up an integration

Most integrations are configured in two places:

1. **Environment variables** (`web/.env`) — the API key or OAuth client credentials. See `admin/SYSTEM_CONFIGURATION.md` for the exact variable names required per integration.
2. **Settings → Integrations (in-app)** — where a user or admin actually connects their own account (OAuth) or enters their own API key, once the server-side environment variables above are set.

An integration whose required environment variable(s) are unset will show a clear "not configured" state in the product — this is deliberate, honest behavior, never a fabricated fallback.

## Integration status summary

| Integration | Status | What "not fully wired" means here, if applicable |
|---|---|---|
| GitHub | Real, fully wired | Powers both real production-affecting pipelines (Remediation, Web Development) |
| Google Search Console | Real, fully wired | — |
| Google Sheets (spreadsheet cleaning) | Real, fully wired | — |
| Google Analytics 4 | Real, fully wired | — |
| Bing Webmaster Tools | Real, fully wired | — |
| DataForSEO | Real, fully wired | Real SERP guest-post search additionally requires `DATAFORSEO_SERP_ALLOW_PRODUCTION=true` |
| PageSpeed Insights / Lighthouse | Real, fully wired | — |
| Pixabay, Pexels | Real, fully wired | — |
| Anthropic, Google Gemini | Real, fully wired | Gemini is a narrow, opt-in fallback for one content-writing seam only |
| WordPress (self-hosted and .com) | Real client code exists | Not confirmed connected to the Website Management Agent's own chat replies — see `agents/website-management-agent.md` |
| Google Business Profile | Real client code exists | Not confirmed connected to that agent's chat replies — see `agents/google-business-profile-agent.md` |
| Google Drive | Real at the list-files level | Full read/write into product workflows NOT VERIFIED IN CURRENT CODEBASE |
| Gmail | Referenced, partial | No safe zero-argument health-check call exists for Gmail by design — this shows as `NOT_TESTED`, not a failure |

See `technical/INTEGRATIONS_REFERENCE.md` for the exact source file and connection model behind each row.

## Verifying a connection's live state

`web/src/server/backend/integration-health-check.ts` calls each integration's own real, already-used server function directly — never through an LLM or a specialist agent. Results:

- `PASS` — the real call succeeded.
- `FAIL` — the real call was attempted and returned a real error.
- `NOT_TESTED` — not connected/configured, or no safe zero-argument call exists (Gmail).
- `PENDING` — reserved for a specific, documented blocked case (Google Trends); confirm the exact meaning directly in code before relying on it.

No credential or token value ever appears in a health-check result. Run this from Settings → Integrations in the product, or via whatever CLI/health-check tooling wraps it (see `admin/TESTING_AND_VALIDATION.md`).

## Credential security

Every integration that stores a token does so through `web/src/server/credential-encryption.ts` (AES-256-GCM, keyed by `CREDENTIAL_ENCRYPTION_KEY`). Confirmed encrypted as of this pass: GitHub, Google Search Console, WordPress (both providers), and the shared Google service connections. Never store a new integration's secret in plaintext, and never log a plaintext or ciphertext value in an error message — see `admin/SECURITY_AND_GOVERNANCE.md`.

## Adding a brand-new third-party integration

1. **Add environment variables** to `web/.env.example` with a comment following the existing convention: where to get the credential, whether it's free/paid, and the exact behavior if unconfigured (must be an honest "not configured" state, never a fabricated fallback).
2. **Add a Prisma connection model** if the integration requires storing tokens/credentials — follow the one-model-per-provider convention (never merge two providers into one model, per the Bing/Google Search Console precedent) and scope it by `userId` (add `@unique` if only one connection per user is meaningful).
3. **Encrypt any stored secret** using `credential-encryption.ts`'s `encryptSecret()`/`decryptSecret()` — never store a plaintext token for a new integration.
4. **Add a route group** under `web/src/app/api/integrations/<name>/**` for connect/callback/disconnect, following the existing OAuth or API-key pattern most similar integrations use.
5. **Add a real client module** under `web/src/server/<name>.ts` exposing `getConnectionStatus()` and whatever real read/write functions are needed — wire it into `integration-health-check.ts` so it participates in the real health-check system.
6. **Wire it into the relevant agent(s)' real dispatch or context-fed prompt**, if applicable — otherwise the integration exists but nothing in chat will use it (a real, previously-observed gap; see the Website Management Agent and Google Business Profile Agent docs for two existing examples of exactly this situation).
7. **Document it** in `technical/INTEGRATIONS_REFERENCE.md` and `admin/SYSTEM_CONFIGURATION.md`.

## Where to modify

- Per-integration client code: `web/src/server/<integration>.ts`.
- Health check: `web/src/server/backend/integration-health-check.ts`.
- Connection models: `web/prisma/schema.prisma`.
- Credential encryption: `web/src/server/credential-encryption.ts`.
