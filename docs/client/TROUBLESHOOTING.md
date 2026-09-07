# Troubleshooting

## "The AI gave an answer that seems made up"

The system is designed to avoid fabricating data, but not every specialist has a real, live lookup behind every topic it can discuss (see `client/AGENT_GUIDE.md` for which is which). If a reply describes an action (e.g. "I've updated your WordPress site" or "I've sent that outreach email") that you did not separately approve or confirm, treat it as a description of what *would* happen, not a confirmed action — verify directly in the relevant system (WordPress, Gmail, GitHub) if you're unsure. If in doubt, ask your administrator to check which mode that specific specialist was operating in.

## "I approved something but nothing happened"

Only real, production-affecting changes (a technical fix, a website-development change) go through the approval process, and both require a connected repository first (Settings → Integrations). If nothing happened after approving, the most common causes are: no repository connected yet, the connection needs to be reconnected, or the approval expired before being acted on. Ask your administrator to check the status directly if this persists. See `client/APPROVALS_AND_HUMAN_CONTROL.md`.

## "An integration says 'not configured'"

This means the required account connection or setup hasn't been completed yet for that specific capability — it's an honest status, not an error on your part. Go to Settings → Integrations to connect the relevant account, or ask your administrator to complete the setup.

## "My request was declined instead of answered"

Occasionally the system declines to proceed rather than guessing at an ambiguous or unsupported request — this is deliberate, especially for anything that could lead to a real change. Try rephrasing your request more specifically, or ask for a narrower version of what you want.

## "A response seems slow"

Requests that involve a real audit, real content generation, or real research can take longer than a simple chat reply, since they involve real lookups and multiple steps running in sequence (see `client/WORKFLOW_GUIDE.md`). This is normal for those request types.

## Still stuck?

Check `client/FAQ.md`, or contact your account administrator — they have access to deeper diagnostic information than is visible from the chat workspace.
