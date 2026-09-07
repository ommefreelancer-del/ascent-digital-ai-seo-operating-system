# Workflow Guide

Some requests trigger more than a single reply — the system runs through several steps automatically, or pauses partway through to ask for your input. This page explains what happens, in plain terms, for the most common multi-step requests. For the full technical version, see `technical/WORKFLOW_ARCHITECTURE.md` (admin/developer audience).

## "Audit my website"

You give a URL (and optionally a target keyword). The system runs a real, automatic crawl and health check covering technical issues, on-page factors, and content signals, and comes back with a scored, prioritized list of findings. This typically takes under a minute. No account connection is required for a basic audit.

## "Find keywords for X" or "Write content about X"

This triggers an automatic, multi-step content pipeline in one go:

1. Real keyword and search-intent research.
2. A strategic framing of how the content should approach the topic.
3. The actual article or page is written, including real images and a quality/originality check.
4. On-page optimization recommendations for the finished piece.
5. If it looks relevant to your request, guest-posting angle suggestions are added too.

You get the finished result as one reply, though you can ask about any individual step along the way.

## "Fix the issues you found" (after an audit)

If the audit found something the system can genuinely fix in your connected repository (currently limited to a narrow, specific set of technical files — not arbitrary code), it will:

1. Diagnose the exact issue.
2. Prepare a specific, concrete fix.
3. **Stop and show you the exact proposed change, asking for your approval.**
4. Only after you approve, apply the real fix to your connected repository.
5. Re-verify the fix actually resolved the issue.

If you reject the proposal, or don't respond before it expires, nothing is changed. See `client/APPROVALS_AND_HUMAN_CONTROL.md`.

## "Make this change to my website" (broader code/content changes)

Similar shape to the fix workflow above, but for a wider range of website changes: the system proposes a plan and a draft of the actual change, and — only after your explicit approval — applies it to your connected repository. Approvals expire after a while; if you wait too long, ask the system to re-propose the change so it's working from the current state of your site.

## Link-building / guest-posting research

Today, this is a set of individually useful specialists (finding prospects, evaluating them, drafting outreach, managing replies) rather than one fully automatic end-to-end pipeline — you'll typically move from one step to the next yourself in conversation, reviewing each stage's output before asking for the next. Real, evidence-based prospect discovery is available; later steps (qualification, outreach drafting, negotiation) are expert-guidance conversations, not automated actions, and nothing is ever sent or agreed to without you doing it yourself.

## Getting a performance report

For a connected Google Search Console or Bing Webmaster Tools account, ask for a report and you'll get one built from your real, current performance numbers. Without a connected account, you'll be told plainly rather than shown fabricated numbers.

## Related reading

- `client/APPROVALS_AND_HUMAN_CONTROL.md` — what an approval request looks like and what your options are.
- `client/INPUTS_AND_OUTPUTS.md` — exactly what to provide for each of these, and what you'll get back.
