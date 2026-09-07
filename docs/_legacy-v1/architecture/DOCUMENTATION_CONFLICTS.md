# Documentation Conflicts & Scope Clarifications

Audience: admin / developer. This file exists specifically to satisfy the requirement that discovered documentation conflicts be recorded, not silently resolved by deleting or overwriting either source.

## Conflict 1: Root `README.md` scope

**What it says:** The root `README.md` describes the Boss Agent module's original milestone scope, stating that "No specialist agent is executed... never a specialist agent logic or module is implemented here."

**Why this reads as a conflict:** Taken as a description of the *whole product*, this appears to contradict the fact that the real, running system (the `web/` application) does execute specialist agent logic extensively — 27 chat-routable agents, several with genuine real-code execution (Website Audit, SEO Content pipeline, Web Development, Technical Remediation), real database persistence, and real external integrations.

**Resolution / correct reading:** The statement is accurate and current for exactly what it describes — the **root `src/boss-agent` package** (`adasos-boss-agent`), whose sole responsibility is producing a `RoutingDecision`, never executing one. This is confirmed directly in `src/boss-agent/boss-agent.ts`'s own header comment: "Reviewing/approving specialist agent *output* and coordinating live inter-agent *communication* are out of scope for this milestone, since no specialist agent is executed here — only a routing decision is produced." The `web/` layer is a separate, later-built system that *consumes* the root package's compiled routing decisions and is the layer that actually executes (or role-plays) specialist behavior. Neither document is "wrong" — they describe two different layers, and neither file states that relationship explicitly on its own.

**Recommendation:** Add a short pointer in root `README.md` (or `PROJECT_OVERVIEW.md`) clarifying that the full product's specialist-execution layer lives in `web/`, to prevent a future reader from concluding the whole system never executes specialist logic. This is a documentation clarity issue, not a code defect — recorded here per instruction, not fixed automatically.

## Conflict 2: Agent spec "Communicates With" vs. real wiring

**What it says:** Every `Agents/<id>.md` spec lists a `Communicates With` section describing bidirectional data flow with other named agents.

**Why this reads as a conflict:** For many agents (e.g. AI CRM Agent, Business Development Agent, Outreach Agent, SEO Strategy Agent when reached outside the content pipeline), no real code path exists in the web layer that actually passes data between the named agents — the spec describes an intended design, and the current implementation is role-play-only with no real inter-agent data transfer.

**Resolution:** Not a factual error — specs describe intended architecture, and role-play agents can still verbally reference the concept of receiving/sending data even though no code executes it. Each individual agent doc in `docs/agents/` states explicitly, per agent, whether the described communication is real or spec-only. See also `docs/architecture/AGENT_COMMUNICATION.md`.

## Conflict 3: "27 agents" — counting BossAgent.md

**Observation:** `Agents/` contains 28 markdown files (27 specialist specs + `BossAgent.md`). `src/agents/` contains exactly 27 subdirectories (one per specialist, no Boss Agent folder — Boss Agent's own implementation lives directly under `src/boss-agent/`, not `src/agents/`). The 27-specialist count is corroborated a third way, independently, by the `*_AGENT_ID` constants and dispatch branches in `web/src/app/api/workspace/messages/route.ts`. **No conflict** — this is documented here only to make the verification method explicit and repeatable for a future auditor.

## Conflict 4: Root-layer agent classes not used by the real web capability

**Observation:** For at least two agents — Web Development Agent and (per its own doc) potentially others — a root-layer class exists under `src/agents/<id>/` but the real, chat-dispatched web capability deliberately does **not** call it, building an independent, self-contained real capability instead (`web-development.ts`'s own header explains why: the root class requires mandatory inputs unsuited to whole-file-aware drafting).

**Resolution:** Not a conflict between documents, but a real architectural fact worth flagging clearly so a future maintainer does not assume editing `src/agents/web-development-agent/` affects the live product's Web Development capability. Documented per-agent in `docs/agents/web-development-agent.md`'s "Where to modify" section and repeated in `admin/MASTER_CHANGE_MAP.md`.

## Conflict 5: `web/src/app/api/seo-audit/route.ts` vs. `website-audit.ts` vs. root `seo-audit-workflow.ts`

**Observation:** Three plausible entry points exist for "run a site audit": the chat-dispatch branch (`website-audit.ts`, confirmed real via `messages/route.ts`), a dedicated UI route (`web/src/app/api/seo-audit/route.ts`), and a root-layer 23-step workflow (`src/workflows/seo-audit-workflow.ts`).

**Status: NOT VERIFIED IN CURRENT CODEBASE.** This documentation pass did not read `web/src/app/api/seo-audit/route.ts`'s imports directly to confirm which of the other two it calls (or whether it has its own third implementation). Recorded here as an open item for the next audit pass rather than guessed at. See `docs/agents/website-audit-agent.md` and the Engineering Follow-ups list in the final completion report.

## Conflict 7: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` documented as NextAuth login, but not registered in `auth.ts`

**What it says:** `web/.env.example` documents these two variables as a standard Google OAuth Client, with redirect URI `http://localhost:3000/api/auth/callback/google` — NextAuth's own default provider-callback URL convention.

**Why this reads as a conflict:** `web/src/server/auth.ts` was read in full; its `authOptions.providers` array contains exactly one entry, `CredentialsProvider`. No `GoogleProvider` (or any NextAuth OAuth provider) is registered anywhere in that file.

**Status: NOT VERIFIED IN CURRENT CODEBASE which side is stale.** Two explanations are equally plausible without further investigation: (a) these variables are consumed by a separate, non-NextAuth-managed route that happens to reuse the same URL shape for historical or consistency reasons, or (b) `.env.example`'s comment is simply outdated relative to the current `auth.ts` (perhaps a Google sign-in option existed previously and was removed). **Recommendation:** grep the codebase for `GOOGLE_CLIENT_ID` usage sites before making any claim to a client that "Sign in with Google" is available — as directly verified in this pass, it is not; only email/password sign-in exists.

## Conflict 8: Whether WordPress/Google Search Console tokens are actually encrypted at rest

**What `credential-encryption.ts` says (its own header comment):** "The existing WordPress/Google Search Console connections... store their tokens as plain columns -- a real, pre-existing gap this file does not retroactively fix."

**What `schema.prisma` says (current, in-line model comments):** `GoogleSearchConsoleConnection`'s token fields are commented "AES-256-GCM encrypted at rest via server/credential-encryption.ts... Never plaintext," and `WordPressConnection`'s are commented "AES-256-GCM encrypted at rest via server/credential-encryption.ts -- see GoogleSearchConsoleConnection's matching fields for the mechanism."

**Status: unresolved, directly contradictory comments in two different files.** The most likely explanation is that `credential-encryption.ts`'s header comment predates a later change that added real encryption to these two connection types, and was never updated to reflect it — but this is an inference, not a confirmed fact. **NOT VERIFIED IN CURRENT CODEBASE:** whether the actual runtime code path that writes/reads `GoogleSearchConsoleConnection.encryptedAccessToken` and `WordPressConnection.encryptedAppPassword`/`encryptedAccessToken` genuinely calls `encryptSecret()`/`decryptSecret()`, or whether the field names were simply renamed to say "encrypted" without the encryption itself being wired in. This is a security-relevant fact and should be confirmed directly (grep for `encryptSecret(` call sites) before this documentation set, or any client-facing security claim, asserts either way with confidence. Recorded in `docs/security/SECURITY_AND_GOVERNANCE.md` as well.

## Conflict 6: Existing dedicated docs preserved, not merged

The repository already contains standalone architecture docs for four subsystems: `docs/architecture/ClientRelationshipManagementAgent.md`, `ConversationLanguageManager.md`, `GuestPostingDigitalPRAgent.md`, `VoiceInterface.md`, plus `docs/bing-webmaster-integration.md` and the governance docs under `docs/governance/`. None of these were deleted, overwritten, or merged into the new structure created in this pass. Where the new documentation set (this one) references the same subsystem, it links to the existing file rather than duplicating its content. If the two ever appear to disagree on a specific fact, the existing, hand-authored file should be treated as the more detailed source for that specific subsystem, and any discrepancy should be reconciled by a human editor, not silently overwritten by either side.
