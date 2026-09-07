# System Configuration

Audience: admin. Sourced directly and completely from `web/.env.example` (the canonical, actively-maintained list) and `src/boss-agent/config/boss-agent.config.ts`. Copy `.env.example` to `.env` (or `.env.local`) and fill in real values before running. **Never place a real secret value in this or any other documentation file — variable names only.**

## Environment variables

| Variable | Required? | Purpose | Behavior if unset |
|---|---|---|---|
| `DATABASE_URL` | Required | SQLite connection string (`file:./prisma/dev.db` by default). Hardened for one PM2 process/one machine via WAL mode + busy_timeout, applied in `web/src/server/db.ts`. | App cannot start / no database. |
| `NEXTAUTH_SECRET` | Required | Session JWT signing secret. Generate with `openssl rand -base64 32`. | In production (`NODE_ENV=production`): the app refuses to start if unset, if it matches a known placeholder, or if under 32 characters (enforced in `auth.ts` at module load, and again at build time by `scripts/validate-startup.mjs`). |
| `NEXTAUTH_URL` | Required | Base URL for NextAuth callbacks. | Auth flows break. |
| `ANTHROPIC_API_KEY` | Required for specialist replies | Powers `generateSpecialistReply()` — the LLM layer for every role-play/context-fed agent reply. | Boss Agent routing still works; no final AI response text can be generated (`AnthropicNotConfiguredError`). |
| `ANTHROPIC_MODEL` | Optional | Overrides the Claude model used for specialist replies. | Defaults to `claude-sonnet-5`. |
| `GOOGLE_GEMINI_API_KEY` | Optional | A second, explicit-opt-in LLM provider used only for the SEO Content Agent's section-writing fallback seam. | That specific seam falls back to its non-Gemini path; the main workspace is unaffected. |
| `GOOGLE_GEMINI_MODEL` | Optional | Overrides the Gemini model. | Defaults to `gemini-flash-latest`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional | A shared, service-agnostic Google OAuth client used for Business Profile/Sheets/Gmail/Drive service *connections* (confirmed via `google-oauth.ts`) — separate from, and not used by, NextAuth login (confirmed: `auth.ts` registers only `CredentialsProvider`). Google Search Console has its own, independent OAuth implementation and does not use this variable. | The affected Google service connections show a clear "not configured" state. |
| `BING_CLIENT_ID` / `BING_CLIENT_SECRET` | Optional | Bing Webmaster Tools OAuth (read-only `Webmaster.read` scope). Registered per Bing Webmaster account, not a shared dev-console project. | "Connect Bing Webmaster Tools" shows a clear "not configured" error. |
| `BING_OAUTH_REDIRECT_URI` | Optional, dev-only | Isolated override for Bing's callback, since Bing's OAuth registration rejects `localhost` redirect URIs (unlike Google/GitHub/NextAuth). Needed only in local dev via a public HTTPS tunnel. | Falls back to the standard `NEXTAUTH_URL`-derived convention (correct for a real deployed domain). |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Optional | Google Analytics 4 client-side tracking tag (distinct from the server-side GA4 Data API connection via `GoogleServiceConnection`). Public/safe to expose (prefixed `NEXT_PUBLIC_`). | No analytics script loads; no tracking — no mock/fallback tracking. |
| `PIXABAY_API_KEY` | Required for the Graphic Design Agent's asset search | Royalty-free stock image/video search. | `/api/assets/pixabay/*` returns a clear "not configured" error. |
| `PEXELS_API_KEY` | Required for generated-content images | Real-photo pipeline for content generation. | Generated articles are left honestly without images. |
| `WPCOM_CLIENT_ID` / `WPCOM_CLIENT_SECRET` | Required for "Connect with WordPress.com" | WordPress.com OAuth (one-click connect option). | That button shows "not configured"; the self-hosted Application Passwords option still works independently. |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Required for real backlink/keyword/SERP data | DataForSEO API credentials (from the API Access tab, not the account email/password). | DataForSEO-backed routes return "not configured." |
| `DATAFORSEO_SANDBOX` | Optional | `"true"` routes every DataForSEO call to the free, dummy-data Sandbox. | Defaults to real, billed API calls. |
| `DATAFORSEO_SERP_ALLOW_PRODUCTION` | Optional | Must be explicitly `"true"` to allow real, billed SERP guest-post discovery calls (blocked by default even with valid credentials). | Real SERP guest-post search is blocked; use Sandbox for wiring/testing. |
| `GOOGLE_PAGESPEED_API_KEY` | Required for real performance data | Enables both the PageSpeed Insights API and the Chrome UX Report API on one key. Free, no billing account required. | The performance provider returns "unavailable" rather than fabricating data. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Required for remediation/web-development execution | GitHub OAuth App for the real repository-write adapter (`web/src/server/github.ts`). | "Connect GitHub" shows "not configured." |
| `GITHUB_TARGET_REPOSITORY` | Optional, dev/bootstrap only | If set to an "owner/repo" the account has push access to, skips the in-app repository picker on connect. | Ignored if invalid; the picker is shown. |
| `CREDENTIAL_ENCRYPTION_KEY` | Required for GitHub connections | AES-256-GCM key (64 hex chars / 32 bytes) encrypting the GitHub OAuth token at rest. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. | Saving a GitHub connection fails with "not configured" — never stores a plaintext token. |

## Boss Agent routing configuration (not environment-only)

| Setting | Default | Override | Purpose |
|---|---|---|---|
| Auto-assign threshold | `0.5` | `BOSS_AGENT_AUTO_ASSIGN_THRESHOLD` | Minimum confidence score before Boss Agent auto-assigns a task to an agent instead of escalating |
| Tie margin | `0.1` | `BOSS_AGENT_TIE_MARGIN` | How close two candidate scores can be before it's treated as an ambiguous tie |
| Max candidates | `5` | `BOSS_AGENT_MAX_CANDIDATES` | How many candidate agents are considered per routing decision |

Source: `src/boss-agent/config/boss-agent.config.ts`. See `technical/BOSS_AGENT_AND_ROUTING.md` for how these values are used, and `admin/MASTER_CHANGE_MAP.md` for the exact testing steps before changing them.

## Notable honest-failure design pattern

Nearly every optional integration variable follows the same convention, stated repeatedly in `.env.example`'s own comments: when unset, the corresponding feature returns a clear "not configured" error or an honest absence (e.g., no images, no analytics) — never a fabricated or mocked result. This is a deliberate, system-wide anti-fabrication convention and should be preserved in any future integration added to the system (see `admin/INTEGRATION_CONFIGURATION.md`).

## Where to modify

- Environment variables: `web/.env` (real values, never committed), `web/.env.example` (documentation of every variable).
- Routing thresholds: `src/boss-agent/config/boss-agent.config.ts`, or the corresponding env vars above.
- Startup validation of these variables: `web/scripts/validate-startup.mjs` (see `admin/TESTING_AND_VALIDATION.md`).
