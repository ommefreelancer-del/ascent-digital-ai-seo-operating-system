# Agent Architecture

Audience: developer/engineer. Describes the general structural pattern every one of the 27 specialist agents follows — the per-agent instantiation of the pattern is in `docs/agents/<id>.md`.

## The three possible parts of "an agent"

Every agent can have up to three distinct artifacts. Not all three exist for every agent, and their existence does not imply they're connected to each other:

1. **Specification** (`Agents/<id>.md`) — always exists (27 files). Markdown: Mission, Responsibilities, Inputs, Outputs, Communicates With, Tools, Rules, Success Criteria, and optionally Tags/Capabilities (used by `TagWeightedRoutingStrategy`). This is the system prompt `generateSpecialistReply()` uses for role-play, and the only artifact that is guaranteed to exist and be "live" in some form for every agent.
2. **Root implementation** (`src/agents/<id>/`) — usually exists as a folder, but its real depth varies per agent and is **not guaranteed to be used by the live product**. At least one confirmed case (Web Development Agent) deliberately does not use its root class at all.
3. **Web dispatch module** (a `web/src/server/backend/<name>.ts` module plus an `assignedAgentId === <AGENT>_AGENT_ID` branch in `web/src/app/api/workspace/messages/route.ts`) — exists only for agents with real (non-role-play) chat execution. Its absence means the agent falls through to role-play.

## Execution-mode classification (defined precisely)

- **Real (dispatched):** a hardcoded branch in `messages/route.ts` matches the agent's ID and calls a real function that performs a genuine action (crawl, database write, real API call).
- **Context-fed (role-play with real data):** no real-action branch, but the prompt sent to Claude is supplemented with real, freshly-fetched data before generation — the reply text is still Claude-authored.
- **Role-play (pure):** no real-action branch and no confirmed real-data injection — the reply is Claude's synthesis grounded only in the agent's spec file.

**Never infer real execution from the spec's Tools section alone.** A spec listing a tool (e.g. "Ahrefs", "Google Search Console") does not mean that tool is actually called for that agent in the live product — check the agent's individual doc's "Current implementation status" field, which is derived from the `messages/route.ts` dispatch grep, not the spec text.

## Verification method used throughout this documentation set

For every agent, execution mode was determined by: (1) reading the agent's full spec, (2) grepping `messages/route.ts` for a `<AGENT>_AGENT_ID` constant and checking whether it appears in a real dispatch branch, (3) where a real branch exists, reading the target `web/src/server/backend/<name>.ts` module directly to confirm what it actually does. This is the same method to use when re-verifying an agent's status after a future code change (see `admin/DOCUMENTATION_MAINTENANCE.md`).

## Where to modify

See each agent's own `docs/agents/<id>.md` "How an admin changes its behavior" section, and `admin/AGENT_CONFIGURATION.md` for the general procedure.
