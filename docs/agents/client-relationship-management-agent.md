# Client Relationship Management Agent

## 1. Agent name
Client Relationship Management Agent

## 2. Agent ID
`client-relationship-management-agent`

## 3. Mission
Centralize client-related operations: accurate client profiles, real sales pipeline tracking, project/campaign status coordination, and real caller-supplied financial records (quotations, contracts, invoices), with human oversight over every commercial decision.

## 4. Responsibilities (per spec)
Maintain client profile records; track sales pipeline stages; track quotations/contracts/invoices; coordinate project status across campaigns; generate client relationship reports; escalate uncertainty.

## 5. Scope
Per spec Rules, explicitly excluded from its own scope: approving financial transactions independently; signing contracts or sending quotations/invoices independently; making business commitments without approval. No confirmed web-layer chat-dispatch bridge exists for any of the in-scope capabilities either.

## 6. Inputs
Per spec: AI CRM Results, Business Development Results, Google Sheets Integration Results, Guest Posting & Digital PR Results, Quotation/Contract/Invoice Records.

## 7. Outputs
Per spec: Client Profiles, Sales Pipeline Report, Financial Summary, Project Coordination Report, Client Relationship Report — currently a Claude-written reply only, absent a confirmed dispatch bridge.

## 8. Tools/integrations actually used
None confirmed wired to this agent specifically.

## 9. Data dependencies
NOT VERIFIED IN CURRENT CODEBASE for the web chat layer. The root-layer implementation may have its own persistence — see `src/agents/client-relationship-management-agent/` and the pre-existing `docs/architecture/ClientRelationshipManagementAgent.md` directly.

## 10. Communication/workflow relationships (per spec)
Receives from: AI CRM Agent, Business Development Agent, Google Sheets Integration Agent, Guest Posting & Digital PR Agent, Boss Agent. Sends to: Boss Agent only — "the agent never bypasses the Boss Agent" (spec Success Criteria).

## 11. Upstream dependencies
None confirmed real in the chat path.

## 12. Downstream dependencies
None confirmed real in the chat path.

## 13. Human approval requirements
Explicit, strong: no independent financial approvals, contract signing, quotation/invoice sending, or business commitments (spec Rules).

## 14. Security restrictions
"Protect all client information," "Maintain complete audit logs" (spec Rules) — audit-log implementation for this agent NOT VERIFIED in the web layer.

## 15. Anti-hallucination requirements
Standard `specialist-ai.ts` guardrail; the substantial gap between this agent's commercial-governance spec and its role-play-only chat execution makes this especially important — see Known Limitations.

## 16. Failure behavior
Standard role-play failure modes in chat.

## 17. Current implementation status
Role-play (LLM only) in the AI Workspace chat. A dedicated root-layer implementation may have additional real behavior documented in `docs/architecture/ClientRelationshipManagementAgent.md` (pre-existing) — read that file directly before assuming chat behavior and root-layer behavior are connected; they are not proven to be.

## 18. Exact specification file path
`Agents/client-relationship-management-agent.md`

## 19. Exact implementation path
`src/agents/client-relationship-management-agent/`; additional architecture reference: `docs/architecture/ClientRelationshipManagementAgent.md`

## 20. Exact routing/dispatch location
None found — standard Boss Agent scoring only, falls through to role-play.

## 21. Related workflow(s)
None of the root workflow files.

## 22. How an admin changes its behavior
Edit `Agents/client-relationship-management-agent.md`. To wire real chat execution, add a bridge module under `web/src/server/backend/` and a dispatch branch in `messages/route.ts`, following the `client-reporting-agent` → `reporting.ts` pattern.

## 23. How a client interacts with it
A client can discuss client-relationship/pipeline topics conversationally, but should treat any claim of a real financial action (quotation sent, invoice tracked, contract signed) as not actually persisted or executed.

## 24. Known limitations
The gap between this agent's substantial financial/commercial-governance spec and its currently role-play-only chat execution is significant.

## 25. Verification status
PARTIALLY VERIFIED — chat path confirmed role-play by dispatch grep; root-layer/architecture-doc behavior NOT independently re-verified in this pass.
