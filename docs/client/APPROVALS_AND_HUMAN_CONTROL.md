# Approvals & Human Control

## The core rule

**The system will never make a real, permanent change to your live website, repository, or connected accounts without asking you to approve it first.** This applies to anything that matters — a real code commit, a real deployment, a real published change. This is a built-in safeguard enforced in how the system works, not just a stated policy.

## What triggers an approval request

Two kinds of requests currently require your explicit approval before anything happens:

1. **A technical fix** to a specific, narrow set of issues found during a website audit (for example, a broken `robots.txt` or sitemap, or a missing canonical link) — proposed after you ask the system to "fix" something it found.
2. **A broader website or code change** — proposed when you ask for a website-development change.

Both require you to have already connected the relevant repository (see `client/GETTING_STARTED.md`).

## What you'll see

When a real change is proposed, you'll be shown the exact, specific change it wants to make — not a vague summary. Review it the way you would review any code or content change someone else drafted for you. You can then:

- **Approve** — the system applies the real change and reports back on the result.
- **Reject** — nothing is changed, and the proposal is discarded.

## Approvals expire

An approval request doesn't stay open forever. If you wait too long, it will expire, and you'll need to ask the system to re-propose the change so it's working from the current, up-to-date state of your site rather than a stale snapshot.

## Who can approve

If your organization uses the read-only access level for some team members, only someone with full access can approve or reject a proposed change. Ask your administrator if you're not sure which access level your login has.

## "I approved something but nothing happened"

The most common causes are: the relevant account (usually GitHub) isn't fully connected yet, the connection needs to be reconnected, or the approval expired before it could be acted on. See `client/TROUBLESHOOTING.md`, or ask your administrator to check the status directly.

## Why some requests get declined automatically instead of asking you

Occasionally the system will decline to proceed with a request entirely, rather than asking you to pick a specialist or approve something ambiguous. This happens when the system isn't confident it understood the request well enough, or when a capability genuinely isn't available — it's designed to ask for a clearer request rather than guess in a situation like this, especially where a production change is involved.
