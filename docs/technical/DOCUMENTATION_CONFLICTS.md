# Documentation Conflicts — Resolution Log

Audience: developer/engineer. This is the authoritative conflict log for the entire three-layer documentation set. Every conflict found during the two documentation passes is listed here with its current resolution status. No conflict is silently dropped — a resolved conflict keeps its history; an unresolved one stays flagged `NOT VERIFIED IN CURRENT CODEBASE` rather than guessed at.

## RESOLVED conflicts (second pass — confirmed against direct code reads)

### Resolved 1 — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are NOT a NextAuth login provider

**Prior conflict:** `.env.example` documented these as a Google OAuth Client with a NextAuth-style callback URL (`/api/auth/callback/google`), while `web/src/server/auth.ts`'s `authOptions.providers` array registers only `CredentialsProvider` — no Google sign-in.

**Resolution (confirmed by direct code read):** `GOOGLE_CLIENT_ID`/`SECRET` are consumed by `web/src/server/google-oauth.ts` (a shared, service-agnostic Google OAuth core for token exchange/refresh/revoke used by Business Profile, Sheets, Gmail, Drive) and independently by `web/src/server/google-search-console.ts`, which builds its own auth URL with the same client ID and a real redirect URI of `${NEXTAUTH_URL}/api/integrations/google-search-console/callback`. **This is a Google service-connection OAuth flow, not a login mechanism.** Sign-in remains confirmed email/password only. The `.env.example` comment's redirect URI (`/api/auth/callback/google`) does not match any real callback route found in the code — this is a genuine, minor documentation inaccuracy in the repository's own `.env.example` file, not a functional defect. **Recorded as an Engineering Follow-up:** update `.env.example`'s comment for `GOOGLE_CLIENT_ID` to state its real purpose (shared Google service-connection OAuth) and correct redirect URI guidance (the actual required redirect URI depends on which Google service route registers the callback — confirm per-service before publishing a corrected value).

### Resolved 2 — WordPress and Google Search Console tokens ARE encrypted at rest

**Prior conflict:** `credential-encryption.ts`'s own header comment stated WordPress/Google Search Console connections "store their tokens as plain columns — a real, pre-existing gap this file does not retroactively fix," while `schema.prisma`'s model comments claimed both use real AES-256-GCM encryption.

**Resolution (confirmed by direct code read):** Both `web/src/server/wordpress.ts` (line 42: `import { encryptSecret, decryptSecret } from "@/server/credential-encryption"`) and `web/src/server/google-search-console.ts` (line 2, same import) genuinely call the real encryption functions. **The schema comments are correct; `credential-encryption.ts`'s own header comment is stale**, describing an earlier state of the codebase that has since been fixed without that file's comment being updated. **Recorded as an Engineering Follow-up:** update `credential-encryption.ts`'s header comment to remove the now-inaccurate claim, so a future reader isn't misled by it.

### Resolved 3 — the SEO Audit UI route calls the same real pipeline as chat dispatch

**Prior conflict:** unclear whether `web/src/app/api/seo-audit/route.ts` calls `website-audit.ts`'s real pipeline, the root 23-step workflow, or its own separate logic.

**Resolution (confirmed by direct code read):** `route.ts`'s `POST` handler calls `runFullAudit(url, targetKeyword)` directly from `web/src/server/backend/website-audit.ts` — the exact same function the chat-dispatch path uses. It does not call the root `seo-audit-workflow.ts`. It additionally applies its own rate limit (15 audits/hour/user, justified in-code as "the single most expensive real operation in the app") and persists the result to `SeoAudit` plus, when a project is specified, a `ProjectActivity` row and an `ActivityEvent`.

### Resolved 4 — the technical remediation adapter's real scope is exactly three operations

**Prior conflict:** whether `github.ts`'s `REMEDIATION_OPERATIONS` covers more than robots.txt/sitemap.xml/canonical-link.

**Resolution (confirmed by direct code read):** `REMEDIATION_OPERATIONS` is a `ReadonlyMap` with exactly three entries: `"robots.txt"` → `replace_file`, `"sitemap.xml"` → `replace_file`, `"index.html"` → `set_canonical_link`. Any other affected resource is explicitly rejected with `NOT_REMEDIABLE: "<resource>" is outside this adapter's approved remediation scope (allowed: this deployment's own origin-root robots.txt, its own origin-root sitemap.xml, or its own homepage's canonical link).` This is a hard, enforced least-privilege boundary, not an incomplete list.

### Resolved 5 — Boss Agent routing thresholds

**Prior conflict:** exact `autoAssignThreshold`/`tieMargin`/`maxCandidates` values were not verified.

**Resolution (confirmed by direct code read of `src/boss-agent/config/boss-agent.config.ts`):** Defaults are `autoAssignThreshold = 0.5`, `tieMargin = 0.1`, `maxCandidates = 5` — each overridable via `BOSS_AGENT_AUTO_ASSIGN_THRESHOLD`, `BOSS_AGENT_TIE_MARGIN`, `BOSS_AGENT_MAX_CANDIDATES` environment variables, layered over defaults and then explicit code overrides (used by tests/CLI flags). The routing module requires no secrets and makes no external API calls — deterministic by design.

## UNRESOLVED / still NOT VERIFIED (carried forward honestly)

### Unresolved 1 — Root `README.md` scope, read as whole-product scope

Root `README.md` states "No specialist agent is executed... never a specialist agent logic or module is implemented here," which is accurate only for the root `src/boss-agent` package specifically, not the whole product (the `web/` layer does execute/role-play specialist logic extensively). Not a code defect — a documentation clarity gap in the repository's own `README.md`. **Recommendation (not applied — documentation-only task, no source files modified):** add one clarifying sentence to root `README.md` pointing to `web/` as the specialist-execution layer.

### Unresolved 2 — Agent spec "Communicates With" sections vs. real wiring

Every `Agents/<id>.md` spec describes bidirectional data flow with named agents; for many agents (AI CRM, Business Development, Outreach, SEO Strategy outside the content pipeline) no real code path passes data between the named agents in the live web product. Not an error — specs describe intended design. Each agent's individual documentation file states its real, current wiring explicitly. See `technical/AGENT_COMMUNICATION.md`.

### Unresolved 3 — Root-layer agent classes not used by their real web capability

At least Web Development Agent's root-layer class (`src/agents/web-development-agent/`) is deliberately not called by the real web capability (`web-development.ts` builds an independent, whole-file-aware implementation instead, per its own header comment). Documented per-agent; not a conflict between documents, but a fact worth flagging so a future maintainer doesn't assume the root class is live.

### Unresolved 4 — Existing dedicated docs preserved, not merged

The repository's own pre-existing docs (`docs/architecture/ClientRelationshipManagementAgent.md`, `ConversationLanguageManager.md`, `GuestPostingDigitalPRAgent.md`, `VoiceInterface.md`, `docs/bing-webmaster-integration.md`, `docs/governance/*`) were not modified or merged into this documentation set. If either source is ever found to disagree with this set on a specific fact, a human editor should reconcile it — neither side should be assumed authoritative by default.

### Unresolved 5 — Exhaustive test coverage

The exact test file inventory and coverage for either the root package or `web/` was not exhaustively enumerated in either documentation pass — confirmed only that a Vitest-based test suite exists and that CI (`ci.yml`) runs `npm test` in both packages as a merge gate. See `technical/TESTING_REFERENCE.md`.

### Unresolved 6 — Guest-posting/outreach pipeline end-to-end automation

Not confirmed whether Publisher Qualification, Contact Intelligence, and Reply & Negotiation stages are wired into one continuous, chat-dispatched real pipeline the way the SEO content-generation pipeline is. See each stage's individual agent doc and `technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`.

## Documentation-internal correction (maintenance pass, 2026-09-06)

### Correction 1 — `admin/SECURITY_AND_GOVERNANCE.md` overstated Google service-connection token encryption

**What was found:** `admin/SECURITY_AND_GOVERNANCE.md`'s "Credential encryption at rest" section previously listed the shared Google service connection tokens (`GoogleServiceConnection` — Business Profile, Sheets, Analytics, Drive, Gmail) under "Confirmed encrypted as of this pass," grouped with `GitHubConnection`, Google Search Console, and WordPress. This did not match `technical/SECURITY_ARCHITECTURE.md`, which already correctly listed `GoogleServiceConnection`'s token fields as "Not independently call-site-verified in this pass" — only a schema comment claims the same encryption mechanism; no `encryptSecret(`/`decryptSecret(` call site for this specific model was confirmed the way it was for the other three connection types.

**Correction applied:** `admin/SECURITY_AND_GOVERNANCE.md` now matches `technical/SECURITY_ARCHITECTURE.md`'s more cautious, already-accurate wording — `GoogleServiceConnection` is listed separately as not independently call-site-verified, rather than grouped with the confirmed connections. No new code verification was performed and no claim was upgraded; this is a wording correction to remove an inconsistency between two documents describing the same fact, not a resolution of the underlying open item. `GoogleServiceConnection` token encryption remains an open item for a future pass to call-site-verify.

## Engineering Follow-ups (recorded, not fixed — documentation-only task)

1. `.env.example`'s `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` comment documents an incorrect redirect URI and an incorrect description of purpose (implies NextAuth login; it is actually a shared Google service-connection OAuth credential). Source file to review: `web/.env.example`.
2. `web/src/server/credential-encryption.ts`'s header comment is stale — it still claims WordPress/Google Search Console tokens are stored in plaintext, which is no longer true. Source file to review: `web/src/server/credential-encryption.ts` (comment only; the encryption logic itself is correct and in active use).
3. Root `README.md` describes only the root Boss Agent package's milestone scope but reads, out of context, as a description of the whole product's capabilities. Source file to review: root `README.md`.
