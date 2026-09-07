# Agent Index

This index lists all 27 specialist agents defined in `Agents/*.md` and documented individually in this folder. Each linked file follows a fixed 25-field template (Agent name → Verification status) and distinguishes three things that are easy to conflate:

- **SPECIFICATION** — what the agent's spec file in `Agents/` says it should do.
- **IMPLEMENTATION** — what code actually exists for it (root `src/agents/<agent>/` class and/or a `web/src/server/backend/*.ts` module).
- **ACTUAL WIRED EXECUTION** — what chat dispatch, a workflow, or an API route actually calls at runtime.

An agent's spec can describe capabilities that are not real today. This index and every linked agent file report execution status as verified directly against the code, not against the spec's description of intent.

## How to read the "Execution Mode" column

- **Real (dispatched)** — chat dispatch (or a workflow/API route) calls a real, non-LLM code path (an API call, a database query, a deterministic computation) as the primary source of the response.
- **Real (context-fed)** — real data is fetched first, then Claude synthesizes the final reply grounded in that real data. The synthesis step is an LLM call, but the facts it is grounded in are real.
- **Role-play** — the reply is produced by `generateSpecialistReply()` in `specialist-ai.ts`, grounded only in the agent's spec file, with no real tool call or data fetch backing it.
- **Split / dual-path** — the same agent ID behaves differently depending on how it is reached (e.g., real via a dedicated API route, role-play via chat). See the agent's own file for the exact split.

"Real" never means the entire spec is implemented — it means the specific path documented in that agent's file is backed by genuine code, verified by direct read.

## Agent Table

| # | Agent | Agent ID | Execution Mode | Notes |
|---|-------|----------|-----------------|-------|
| 1 | [Admin Agent](admin-agent.md) | `admin-agent` | Split — Real (context-fed) / Role-play | Real for governance-evidence reporting; role-play for the broader documentation/SOPs/contracts mission in the spec. |
| 2 | [AI CRM Agent](ai-crm-agent.md) | `ai-crm-agent` | Role-play | No dispatch branch found in `messages/route.ts`. |
| 3 | [Business Development Agent](business-development-agent.md) | `business-development-agent` | Role-play | LLM only. |
| 4 | [Campaign Tracking Agent](campaign-tracking-agent.md) | `campaign-tracking-agent` | Real (dispatched) | Genuine agent-class execution plus real database persistence. |
| 5 | [Client Relationship Management Agent](client-relationship-management-agent.md) | `client-relationship-management-agent` | Role-play (chat) | A separate root-layer implementation may exist; not proven connected to chat. |
| 6 | [Client Reporting Agent](client-reporting-agent.md) | `client-reporting-agent` | Split — Role-play (chat) / Real (Reports feature) | Real only via the dedicated Reports feature (`/api/reports/**`), which bypasses Boss Agent routing entirely. |
| 7 | [Competitor Intelligence Agent](competitor-intelligence-agent.md) | `competitor-intelligence-agent` | Real (dispatched) | Genuine `CompetitorIntelligenceAgent` + `WebsiteAuditAgent` class execution against real fetched data. |
| 8 | [Contact Intelligence Agent](contact-intelligence-agent.md) | `contact-intelligence-agent` | Role-play | LLM only. |
| 9 | [Content Strategy Agent](content-strategy-agent.md) | `content-strategy-agent` | Real (embedded) | Genuine class execution as part of the content pipeline. |
| 10 | [Google Business Profile Agent](google-business-profile-agent.md) | `google-business-profile-agent` | Split — Role-play (chat) / Real (OAuth integration) | Real GBP OAuth connection exists but is not confirmed wired into this agent's chat replies. |
| 11 | [Google Sheets Integration Agent](google-sheets-integration-agent.md) | `google-sheets-integration-agent` | Real (context-fed), partial | Real for connection-status reporting; deeper read/write actions NOT VERIFIED. |
| 12 | [Graphic Design Agent](graphic-design-agent.md) | `graphic-design-agent` | Real (dispatched) | Genuine Pixabay API call executes. |
| 13 | [Guest Posting & Digital PR Agent](guest-posting-digital-pr-agent.md) | `guest-posting-digital-pr-agent` | Role-play (context-fed via pipeline) | Context-fed only when reached through the content pipeline; standalone dispatch is plain role-play. |
| 14 | [Keyword Research & Search Intent Agent](keyword-research-agent.md) | `keyword-research-agent` | Real (dispatched) | Genuine agent-class execution against real (or honestly absent) DataForSEO data. |
| 15 | [Off-Page SEO Agent](off-page-seo-agent.md) | `off-page-seo-agent` | Real (context-fed) | Real backlink-data API call when configured; final reply is Claude-written, grounded in that data. |
| 16 | [On-Page SEO Agent](on-page-seo-agent.md) | `on-page-seo-agent` | Split — Role-play (chat pipeline) / Real (`seo-audit-workflow.ts`) | Two unconnected code paths under the same agent identity. |
| 17 | [Outreach Agent](outreach-agent.md) | `outreach-agent` | Role-play | LLM only. |
| 18 | [Performance & Analytics Agent](performance-analytics-agent.md) | `performance-analytics-agent` | Real (context-fed) | Live Google Search Console/Bing Webmaster calls first, then Claude-written synthesis. Pattern other context-fed agents mirror. |
| 19 | [Prospecting Agent](prospecting-agent.md) | `prospecting-agent` | Real (dispatched) | Genuine DataForSEO SERP calls and real, read-only HTTP fetches. |
| 20 | [Publisher Qualification Agent](publisher-qualification-agent.md) | `publisher-qualification-agent` | Role-play | LLM only; hand-off from Prospecting Agent is not automated. |
| 21 | [Reply & Negotiation Agent](reply-negotiation-agent.md) | `reply-negotiation-agent` | Role-play | LLM only; no real email read/send wiring. |
| 22 | [SEO Content Agent](seo-content-agent.md) | `seo-content-agent` | Real (dispatched) | The most deeply real-code-backed agent: real keyword research, strategy input, generated prose, structural QA, real image attachment. |
| 23 | [SEO Strategy Agent](seo-strategy-agent.md) | `seo-strategy-agent` | Role-play (context-fed via pipeline) | Stage 2 of the 5-stage content pipeline only; no standalone dispatch. |
| 24 | [Technical SEO Agent](technical-seo-agent.md) | `technical-seo-agent` | Real (dispatched) | Shares its entire pipeline with the Website Audit Agent — not functionally separate in code. |
| 25 | [Web Development Agent](web-development-agent.md) | `web-development-agent` | Real (dispatched) | Real plan/draft/approve/apply pipeline; does NOT use the frozen root class of the same name. |
| 26 | [Website Audit Agent](website-audit-agent.md) | `website-audit-agent` | Real (dispatched) | The single most reused real pipeline among all 27 agents. |
| 27 | [Website Management Agent](website-management-agent.md) | `website-management-agent` | Split — Role-play (chat) / Real (WordPress integration, unconfirmed wiring) | Real WordPress publishing exists as a separate Settings integration, not confirmed connected to this agent's chat identity. |

## Execution-mode summary

- **Real (dispatched):** Campaign Tracking, Competitor Intelligence, Content Strategy (embedded), Graphic Design, Keyword Research & Search Intent, Prospecting, SEO Content, Technical SEO, Web Development, Website Audit — 10 agents.
- **Real (context-fed):** Google Sheets Integration (partial), Off-Page SEO, Performance & Analytics — 3 agents (plus Admin Agent's governance-reporting path).
- **Split / dual-path (real in one reachable path, role-play in another):** Admin Agent, Client Reporting, Google Business Profile, On-Page SEO, Website Management — 5 agents.
- **Role-play (LLM only), no confirmed real backing today:** AI CRM, Business Development, Client Relationship Management (chat), Contact Intelligence, Guest Posting & Digital PR, Outreach, Publisher Qualification, Reply & Negotiation, SEO Strategy — 9 agents.

These counts total 27. See each agent's own file (fields 17, 19, 20, 24, 25) for the exact code path and verification evidence behind its classification, and see `technical/AGENT_ARCHITECTURE.md` for the system-wide explanation of why real, context-fed, and role-play agents coexist by design.

## Related documentation

- `technical/AGENT_ARCHITECTURE.md` — the architectural explanation of the three execution modes and why the system is built this way.
- `technical/AGENT_COMMUNICATION.md` — how agents pass data to each other (and where that hand-off is real vs. spec-only).
- `technical/BOSS_AGENT_AND_ROUTING.md` — how a message is routed to an agent ID in the first place.
- `technical/DOCUMENTATION_CONFLICTS.md` — every conflict found between an agent's spec and its real implementation, resolved or still open.
- `admin/MASTER_CHANGE_MAP.md` — where an admin changes any specific agent's behavior, by exact file path.
- `client/AGENT_GUIDE.md` — the client-facing description of what each agent can do today, written without exposing internal paths or execution-mode terminology.
