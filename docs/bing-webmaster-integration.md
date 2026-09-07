# Bing Webmaster Tools Integration

Real, OAuth 2.0-based, read-only integration with Bing Webmaster Tools,
mirroring the existing Google Search Console integration's architecture.
Added alongside GSC -- it does not modify, replace, or remove it.

## Why OAuth 2.0 (not the legacy API key)

Verified directly against Microsoft's live documentation on 2026-08-27:

- **Legacy SOAP and POX APIs retire August 31, 2026** (per
  [learn.microsoft.com/en-us/bingwebmaster/](https://learn.microsoft.com/en-us/bingwebmaster/)
  and
  [.../api-protocols](https://learn.microsoft.com/en-us/bingwebmaster/api-protocols)).
  This integration uses the REST/JSON protocol exclusively.
- Bing documents two authentication methods for that REST/JSON protocol:
  a per-user **API key** (query parameter `apikey=`), and **OAuth 2.0**
  (`[Recommended]`, Bearer token). This integration uses OAuth 2.0 only --
  never the API key.

## Architecture

Mirrors `web/src/server/google-search-console.ts` exactly:

| Concern | Google Search Console | Bing Webmaster |
| --- | --- | --- |
| Server module | `server/google-search-console.ts` | `server/bing-webmaster.ts` |
| DB model | `GoogleSearchConsoleConnection` | `BingWebmasterConnection` |
| Token encryption | AES-256-GCM, `credential-encryption.ts` | same, same module |
| OAuth routes | `api/integrations/google-search-console/*` | `api/integrations/bing-webmaster/*` |
| Grounding-context builder | `buildSearchConsoleContext()` | `buildBingWebmasterContext()` |
| Agent reach | Performance & Analytics Agent only | Performance & Analytics Agent only |

Two genuinely different provider models, two genuinely different Prisma
tables -- never merged into one connection row or one context block, so
"which provider does this number come from" is never ambiguous (see
**Data-source boundaries** below).

## OAuth flow

1. `GET /api/integrations/bing-webmaster/connect` -- redirects to
   `https://www.bing.com/webmasters/oauth/authorize` with `response_type=code`,
   `client_id`, `redirect_uri`, `scope=Webmaster.read`, and a CSRF `state`
   (stored in an `httpOnly` cookie, mirroring the GSC flow's `gsc_oauth_state`
   cookie).
2. `GET /api/integrations/bing-webmaster/callback` -- validates `state`,
   exchanges the authorization code at `https://www.bing.com/webmasters/oauth/token`
   (`grant_type=authorization_code`), and persists the encrypted access +
   refresh token.
3. `getValidAccessToken()` refreshes automatically (same token endpoint,
   `grant_type=refresh_token`) whenever the stored token is within 60 seconds
   of expiry -- the caller never sees an expired token.
4. Every real API call sends `Authorization: Bearer <token>` -- the token is
   never placed in a URL, logged, or included in any error message.

### Scope

`Webmaster.read` only (the read-only scope Bing documents) -- least
privilege, matching Google Search Console's own `webmasters.readonly`.
`Webmaster.manage` (write access) is never requested, so this integration
structurally cannot submit URLs, submit sitemaps, or change crawl settings
-- see **Capabilities not implemented** below.

### Required external configuration (cannot be done in code)

Unlike Google, a Bing Webmaster OAuth client is registered **per Bing
Webmaster account**, not via a shared developer console project. You must:

1. Sign in at <https://www.bing.com/webmasters>.
2. Settings -> API Access -> accept the Terms and Conditions -> **OAuth
   Client**.
3. Register a client: any display Name, and Redirect URI **exactly**
   `http://localhost:3000/api/integrations/bing-webmaster/callback` (must
   match exactly, including trailing slashes/case, or Bing rejects the
   callback).
4. Copy the generated Client ID and Client Secret into `web/.env`:
   ```
   BING_CLIENT_ID="..."
   BING_CLIENT_SECRET="..."
   ```
5. Your Bing Webmaster account must have at least one **verified** site for
   any data capability below to return real data.

No credentials, client IDs, or secrets were fabricated anywhere in this
implementation -- both env vars default to placeholder strings in
`.env.example` and every capability degrades to an honest "not configured" /
"not connected" state without them.

## Capabilities implemented (real, `Webmaster.read`-scoped REST/JSON methods)

Every method name and response field below is taken verbatim from
Microsoft's own .NET API reference for the Bing Webmaster REST/JSON API
(`learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi*`),
fetched directly before implementation -- never invented.

| Function | Bing method | Real data |
| --- | --- | --- |
| `listSites()` / `getVerifiedSites()` | `GetUserSites` | Every site on the account, verified or not |
| `getQueryStats()` | `GetQueryStats(siteUrl)` | Per-query clicks/impressions/avg click & impression position (updated weekly) |
| `getRankAndTrafficStats()` | `GetRankAndTrafficStats(siteUrl)` | Site-wide daily clicks/impressions across Web/Chat/News/Images/Videos/Knowledge Panel |
| `getCrawlStats()` | `GetCrawlStats(siteUrl)` | Daily crawl stats (crawled pages, index count, inbound links, HTTP status code buckets, robots.txt blocks) for the last 6 months |
| `getLinkCounts()` | `GetLinkCounts(siteUrl, page)` | Real inbound-link counts per page of the verified site, as seen by Bing's own crawler |
| `getFeeds()` | `GetFeeds(siteUrl)` | Every sitemap/feed registered for the site, with its real crawl status |

`buildBingWebmasterContext(userId)` (in `server/backend/performance-analytics.ts`)
combines `getQueryStats` + `getRankAndTrafficStats` into one grounding-context
block for the Performance & Analytics Agent, exactly mirroring
`buildSearchConsoleContext()`'s existing shape and honesty conventions.

### Capabilities not implemented (disclosed, not hidden)

Real, documented Bing Webmaster methods that exist but are **deliberately
out of scope** for this least-privilege, read-only integration pass:

- `SubmitUrl` / `SubmitUrlBatch` / `SubmitContent` -- URL/content submission (write, `Webmaster.manage`)
- `SubmitFeed` / `RemoveFeed` -- sitemap submission/removal (write)
- `SaveCrawlSettings`, `AddSite`/`RemoveSite`, site-role delegation, blocked-URL management, country/region settings, deep links -- account/site administration (write, higher privilege than a reporting integration needs)

These are real, available capabilities in Bing's API -- not fabricated as
"unavailable" -- but genuinely not implemented here. Extending to
`Webmaster.manage` for write capabilities is a legitimate, separate future
change, mirroring exactly how Google Search Console's own integration in
this codebase is also read-only today.

## Data-source boundaries (Phase 4/5/6 of this task)

Every function and grounding-context string in this integration is
explicitly labeled `Bing Webmaster` / `GetQueryStats` / `GetRankAndTrafficStats`
etc. -- never a generic "search performance" without attribution. Concretely:

- `BingQueryStat`, `BingRankAndTrafficStat`, `BingCrawlStat`, `BingLinkCounts`,
  `BingFeed`, `BingSite` are separate TypeScript types from Google Search
  Console's `SearchAnalyticsRow`/`SearchConsoleSite` -- structurally
  impossible to pass one where the other is expected.
- `buildBingWebmasterContext()`'s output is a separate string, appended as
  its own block after `buildSearchConsoleContext()`'s block, and explicitly
  states "a distinct source from Google Search Console above; never combine
  these numbers into one total."
- **This codebase has no real Semrush integration at all** (DataForSEO is
  the real keyword/competitive-data provider -- see `server/dataforseo.ts`).
  `buildBingWebmasterContext()`'s own text states plainly: Bing's query data
  is the verified site's own real search performance, "NOT a comprehensive
  keyword-volume database, keyword-difficulty score, competitor analysis, or
  a replacement for Semrush/Ahrefs" -- so "Semrush keyword metrics are
  unavailable" remains this system's honest, unmodified default state.
- Competitor analysis is unaffected: nothing in this integration reports on
  any site other than the one(s) verified in the connected Bing Webmaster
  account.

## Agent access (Phase 7)

**Performance & Analytics Agent only** -- added to its `Tools`/`Tags`/
`Capabilities` in `Agents/performance-analytics-agent.md`, and wired into
its existing real-data grounding branch in
`web/src/app/api/workspace/messages/route.ts` (the same branch that already
calls `buildSearchConsoleContext()`; no routing/task-router/capability-
classifier code was touched).

Not wired to SEO Strategy Agent, Website Audit/Technical SEO Agent, or
Keyword Research Agent in this pass -- Google Search Console isn't wired to
them either today, so this keeps the two providers symmetric and
least-privilege rather than expanding scope unrelated to this task.
Extending both together is a legitimate, separate future change.

What Performance & Analytics Agent is allowed to conclude from Bing data:
real clicks/impressions/query/crawl/link numbers for the verified site, and
trends within them. What it must not claim: keyword search volume,
keyword difficulty, keyword opportunity scores, competitor rankings,
competitor traffic, or competitor keyword counts -- Bing Webmaster does not
provide these, and the grounding-context text says so explicitly.

## Error handling (Phase 9)

`server/bing-webmaster.ts` classifies failures into specific, real error
types rather than one generic error:

- `BingWebmasterNotConnectedError` -- no connection exists for the user.
- `BingWebmasterAuthError` -- HTTP 401 from a data call, or the refresh-token
  exchange itself was rejected (revoked/invalid grant). Never includes the
  token value.
- `BingWebmasterRateLimitError` -- HTTP 429.
- `BingWebmasterApiError` -- any other non-2xx, carries the real status and
  response body (secrets are never in that body -- only the caller's own
  request parameters and Bing's own error message are).
- Network failure / timeout -- a 15-second `AbortController` timeout, and a
  network-level fetch failure, both surface as a real, specific message
  (never silently retried, never a fabricated success).
- Malformed (non-JSON) response, or a response missing the documented
  `{"d": ...}` envelope -- both throw a specific, honest error rather than
  crashing on `undefined` access or silently returning empty data.
- Empty dataset (Bing genuinely has no rows yet) -- returned as `[]`, and
  `buildBingWebmasterContext()` reports this as "returned zero rows... do
  not fabricate numbers", never treated as an error.
- Missing configuration (`BING_CLIENT_ID`/`SECRET` unset) -- the `connect`
  route returns a clear 503 rather than redirecting to a broken OAuth URL;
  `validate-startup.mjs` warns (not fails) the same way it does for Google's
  own client ID/secret.

## Testing performed (Phase 10)

- `npx tsc --noEmit` across `web/` -- clean.
- `web/tests/server/bing-webmaster.test.ts` (16 tests) -- mocked
  `@/server/db`, real `fetch` stubbing asserting the exact REST/JSON URL,
  method, and `Authorization: Bearer` header (never `apikey=`); real
  `.NET Date()` parsing; every documented response shape (`GetQueryStats`,
  `GetRankAndTrafficStats`, `GetLinkCounts`, `GetFeeds`) parsed and asserted
  field-by-field; every error class (401/429/5xx/malformed JSON/missing `d`
  envelope) exercised; token refresh (success and revoked-grant) exercised;
  a structural test proving Bing's own types never share a field name with
  Google Search Console's `SearchAnalyticsRow`.
- `web/tests/server/backend/performance-analytics.test.ts` (5 tests) --
  `buildBingWebmasterContext()`'s not-connected/no-verified-site/zero-rows/
  real-data/auth-error branches, and a direct assertion that
  `buildSearchConsoleContext()` and `buildBingWebmasterContext()` never
  share a source label.
- All new/mocked -- **this is unit-test evidence, not live validation** (see
  below).

## Live validation (Phase 11)

**Not performed -- blocked on external configuration only I can't complete
for you.** `BING_CLIENT_ID`/`BING_CLIENT_SECRET` are unset (still the
`.env.example` placeholders); no Bing Webmaster OAuth client has been
registered. To get real live evidence:

1. Complete the **Required external configuration** steps above.
2. Restart the dev server (`npm run dev` picks up the new env vars).
3. Settings -> Integrations -> Connect Bing Webmaster Tools, sign in with
   your Bing Webmaster account, and grant `Webmaster.read`.
4. Ask the AI Workspace a Performance & Analytics question (e.g. "How is our
   Bing search performance?") -- the reply will be grounded in a real
   `buildBingWebmasterContext()` call.

I did not fabricate any live evidence, response body, or "it worked" claim
in place of this.

## Known limitations

- Read-only (`Webmaster.read`) -- no URL/sitemap submission, no crawl-setting
  writes. See **Capabilities not implemented**.
- `GetQueryStats` is Microsoft's own documented update cadence: weekly, not
  real-time.
- Bing Webmaster's OAuth documentation shows no token-revocation endpoint
  (unlike Google's `/revoke`) -- `disconnect()` deletes the stored, encrypted
  token locally (the complete, real action available); the token then simply
  expires naturally on Bing's side.
- No live validation yet (see above) -- purely because the required Bing
  Webmaster OAuth client hasn't been registered, not a code limitation.

## Confirmations

- **Google Search Console integration is fully intact** -- no line of
  `google-search-console.ts`, its API routes, or its DB model was modified,
  removed, or replaced. `buildSearchConsoleContext()` still runs first and
  unchanged; Bing's context block is purely additive.
- **Semrush remains a separate, required provider** for comprehensive
  keyword-volume/competitive-intelligence research -- this codebase has no
  real Semrush connection (by design, unrelated to this task), and nothing
  in this integration claims otherwise or substitutes Bing/DataForSEO data
  for it.
- **Routing system untouched** -- no change to `task-router.ts`,
  `capability-classifier.ts`, or any `tag-weighted-routing-strategy.ts` file.
- **Pixabay/Graphic Design untouched.**
