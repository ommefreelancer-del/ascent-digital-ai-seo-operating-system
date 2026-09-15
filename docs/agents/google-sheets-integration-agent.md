# Google Sheets Integration Agent

## 1. Agent name
Google Sheets Integration Agent

## 2. Agent ID
`google-sheets-integration-agent`

## 3. Mission
Manage, synchronize, and maintain Google Sheets used for clients, publishers, outreach, guest posting, pricing, and campaign tracking, with data accuracy and consistency.

## 4. Responsibilities (per spec)
Read/update Google Sheets; add client/publisher records; update pricing/outreach/deal/payment/guest-posting status; maintain backlink records; detect/prevent duplicates; synchronize with AI CRM Agent; generate spreadsheet summaries; flag inconsistencies; request approval before sensitive changes; report real, account-scoped connection/health-check status.

## 5. Scope
The verified real capability is connection/health-check status reporting. Full spreadsheet CRUD as described in the spec is not confirmed wired through this chat bridge.

## 6. Inputs
A user chat message; real connection status from `server/google-sheets.ts`.

## 7. Outputs
Real connection/health-check status text, appended to the prompt before `generateSpecialistReply()` writes the final reply.

## 8. Tools/integrations actually used
Google Sheets API, Google Drive API, via `web/src/server/google-sheets.ts` — OAuth2, backed by the shared `GoogleServiceConnection` table, with a live "Connect Google Sheets" control in Settings → Integrations. Also confirmed used separately (unrelated feature) by the human-approval-gated spreadsheet-cleaning capability (`SpreadsheetCleaningApproval`).

## 9. Data dependencies
`GoogleServiceConnection` (read, for the requesting account only).

## 10. Communication/workflow relationships (per spec)
Receives from: Reply & Negotiation Agent, AI CRM Agent, Boss Agent. Sends to: Boss Agent, AI CRM Agent, Client Reporting Agent.

## 11. Upstream dependencies
Real connection status from `google-sheets.ts`.

## 12. Downstream dependencies
None confirmed beyond the chat reply.

## 13. Human approval requirements
Per spec Rules: "Request user approval before major updates or deletions" — enforcement for any real write operation is NOT VERIFIED beyond the connection-status reporting capability.

## 14. Security restrictions
Account-scoped connection lookup only (mirrors the Google Search Console integration's convention).

## 15. Anti-hallucination requirements
Spec Capabilities explicitly state real, account-scoped status reporting, never fabricated. Follows the same four-state honesty pattern used by `performance-analytics.ts`.

## 16. Failure behavior
Not connected / connected but unverified / connected+verified but no data yet / real data — never fabricates a state.

## 17. Current implementation status
Real (context-fed) for connection-status reporting. Deeper spreadsheet read/write actions are NOT VERIFIED to be real vs. still role-play.

## 18. Exact specification file path
`Agents/google-sheets-integration-agent.md`

## 19. Exact implementation path
`src/agents/google-sheets-integration-agent/` (root); `web/src/server/backend/google-sheets-integration.ts` (real bridge); `web/src/server/google-sheets.ts` (underlying connector)

## 20. Exact routing/dispatch location
`web/src/app/api/workspace/messages/route.ts` — `GOOGLE_SHEETS_INTEGRATION_AGENT_ID` branch, calls `buildGoogleSheetsContext()` then `generateSpecialistReply()`

## 21. Related workflow(s)
None of the root workflow files; also relevant: the separate spreadsheet-cleaning capability (see `technical/INTEGRATIONS_REFERENCE.md`).

## 22. How an admin changes its behavior
Edit `web/src/server/backend/google-sheets-integration.ts` for the real bridge logic; edit `web/src/server/google-sheets.ts` for the underlying OAuth/API client.

## 23. How a client interacts with it
A client with a connected Google Sheets account can ask about the connection's real status and get an accurate answer; deeper spreadsheet edits requested in chat should not be assumed to actually happen without further verification.

## 24. Known limitations
Full spreadsheet CRUD (adding client/publisher rows, updating pricing, duplicate detection) as described in the spec's Responsibilities is not confirmed to be wired through this chat bridge.

## 25. Verification status
PARTIALLY VERIFIED — connection-status reporting confirmed real by direct code read; full CRUD scope NOT VERIFIED.
