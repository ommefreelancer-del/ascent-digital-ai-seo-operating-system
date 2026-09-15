# Known Limitations

Audience: developer/engineer. A single consolidated list of real, confirmed system limitations — cross-referenced from client, admin, and technical docs so it exists in exactly one place.

## Architecture / scale

- **Single-process, single-machine deployment** (SQLite, PM2 fork mode) — no horizontal scaling; a documented Postgres migration path exists but is not implemented. See `DEPLOYMENT_REFERENCE.md`.
- **No multi-tenant/Organization model** — every `User` row is its own fully isolated tenant; no invite/team-sharing flow. See `admin/SUBSCRIPTION_READINESS.md`.
- **No billing/subscription/plan system.**
- **Login rate limiting is in-memory and single-instance** — would need a shared store (Redis) for a multi-instance deployment.
- **No automated database backup schedule.**

## Agent execution honesty gaps (by design, documented per-agent)

Several agents have a real, working integration that is not confirmed connected to that specific agent's own chat replies:
- Website Management Agent — real WordPress integration exists; not confirmed wired into this agent's chat dispatch.
- Google Business Profile Agent — real connection exists; not confirmed wired into this agent's chat dispatch.
- SEO Strategy, On-Page SEO, Guest Posting & Digital PR (as pipeline stages 2/4/5) — role-play, by explicit code-comment design, not oversight.

See `agents/INDEX.md` for the full execution-mode table.

## Guest-posting/outreach pipeline

Not confirmed to be automated end-to-end the way SEO content-generation is — Publisher Qualification, Contact Intelligence, and Reply & Negotiation's real wiring status is `NOT VERIFIED`. See `technical/workflows/GUEST_POSTING_OUTREACH_WORKFLOW.md`.

## Documentation-flagged code comment staleness (Engineering Follow-ups, not fixed in this pass)

1. `web/.env.example`'s `GOOGLE_CLIENT_ID` comment documents an incorrect purpose/redirect URI.
2. `web/src/server/credential-encryption.ts`'s header comment incorrectly claims WordPress/GSC tokens are stored in plaintext (they are encrypted).
3. Root `README.md`'s scope statement, read without context, appears to contradict the real product's specialist-execution capability.

See `DOCUMENTATION_CONFLICTS.md` for full detail on each.

## Testing coverage

Exact test file inventory/coverage percentage not exhaustively enumerated; the two most safety-critical real pipelines (remediation's GitHub write, web-development's commit) do not have confirmed dedicated integration test coverage beyond CI's generic `npm test` gate. See `TESTING_REFERENCE.md`.

## Root-layer agent classes not used by their real web capability

At least Web Development Agent's root class is deliberately unused by the real web pipeline. A future maintainer should not assume editing a root `src/agents/<id>/` class affects the live product for every agent — verify per-agent via `AGENT_ARCHITECTURE.md`'s method.
