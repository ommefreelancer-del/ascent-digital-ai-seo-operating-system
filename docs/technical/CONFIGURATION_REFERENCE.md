# Configuration Reference

Audience: developer/engineer. Sourced completely from `web/.env.example`. Variable **names** only — never a value, secret, or example key. See `admin/SYSTEM_CONFIGURATION.md` for the admin-facing "how to configure" version of this document.

| Variable | Required? | Purpose | Behavior if unset |
|---|---|---|---|
| `DATABASE_URL` | Required | SQLite connection string. | App cannot start. |
| `NEXTAUTH_SECRET` | Required | Session JWT signing secret. | Production (`NODE_ENV=production`): app refuses to start if unset, a known placeholder, or under 32 characters — enforced in `auth.ts` at module load, plus `scripts/validate-startup.mjs` at build time. |
| `NEXTAUTH_URL` | Required | Base URL for callbacks. | Auth/OAuth callback flows break. |
| `ANTHROPIC_API_KEY` | Required for specialist replies | Powers `generateSpecialistReply()`. | Routing still works; no reply text generated (`AnthropicNotConfiguredError`). |
| `ANTHROPIC_MODEL` | Optional | Overrides the Claude model. | Defaults to `claude-sonnet-5`. |
| `GOOGLE_GEMINI_API_KEY` | Optional | Second LLM provider, SEO Content Agent's section-writing seam only. | That seam falls back to its non-Gemini path. |
| `GOOGLE_GEMINI_MODEL` | Optional | Overrides the Gemini model. | Defaults to `gemini-flash-latest`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Required for Google service connections | Confirmed used by `google-oauth.ts` (shared core for Business Profile/Sheets/Gmail/Drive) and independently by `google-search-console.ts`. **Not** a NextAuth login provider — see `DOCUMENTATION_CONFLICTS.md` Resolved 1. | Each affected connect flow returns its own real OAuth error. |
| `BING_CLIENT_ID` / `BING_CLIENT_SECRET` | Optional | Bing Webmaster Tools OAuth, registered per Bing Webmaster account. | "Connect Bing Webmaster Tools" shows "not configured." |
| `BING_OAUTH_REDIRECT_URI` | Optional, dev-only | Isolated override for Bing's callback (Bing rejects `localhost` redirects). | Falls back to the standard `NEXTAUTH_URL`-derived convention. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Optional | Client-side GA4 tracking tag (distinct from the server-side GA4 Data API connection). | No analytics script loads. |
| `PIXABAY_API_KEY` | Required for Graphic Design Agent's asset search | Royalty-free image/video search. | Route returns "not configured." |
| `PEXELS_API_KEY` | Required for generated-content images | Real-photo content pipeline. | Content generated without images. |
| `WPCOM_CLIENT_ID` / `WPCOM_CLIENT_SECRET` | Required for WordPress.com one-click connect | WordPress.com OAuth. | Button shows "not configured"; self-hosted option unaffected. |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Required for real backlink/keyword data | DataForSEO API credentials (API Access tab, not account login). | Routes return "not configured." |
| `DATAFORSEO_SANDBOX` | Optional | Routes calls to the free dummy-data Sandbox. | Defaults to real, billed calls. |
| `DATAFORSEO_SERP_ALLOW_PRODUCTION` | Optional | Must be explicit `"true"` to allow real, billed SERP guest-post search. | Real SERP search blocked by default. |
| `GOOGLE_PAGESPEED_API_KEY` | Required for real performance data | Enables PageSpeed Insights + Chrome UX Report on one key. | Provider returns "unavailable." |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Required for remediation/web-dev execution | GitHub OAuth App. | "Connect GitHub" shows "not configured." |
| `GITHUB_TARGET_REPOSITORY` | Optional, dev/bootstrap only | Skips the in-app repository picker on connect if valid. | Ignored if invalid; picker shown. |
| `CREDENTIAL_ENCRYPTION_KEY` | Required for GitHub connections (and, confirmed, WordPress/GSC connections) | AES-256-GCM key encrypting OAuth tokens at rest. | Saving an affected connection fails with "not configured" — never stores plaintext. |

## Design convention (system-wide, not per-integration accident)

Every optional integration variable follows the same pattern: unset → a clear "not configured" error or an honest absence (no images, no analytics) — never a fabricated result. Preserve this convention in any new integration (see `EXTENSION_GUIDE.md`).

## Configuration file locations

- `.env` / `.env.local` (from `web/.env.example`) — runtime secrets/config, never committed.
- `web/ecosystem.config.cjs` — PM2 process definition (see `DEPLOYMENT_REFERENCE.md`).
- `web/prisma/schema.prisma` — database schema (`DATABASE_URL` target).
- `src/boss-agent/config/boss-agent.config.ts` — routing thresholds, overridable via `BOSS_AGENT_*` env vars (see `BOSS_AGENT_AND_ROUTING.md`).
