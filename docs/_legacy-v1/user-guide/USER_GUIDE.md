# User Guide

Audience: client / end-user, no technical background assumed.

## Getting started

1. Go to the app's web address and sign in (or create an account if this is your first time — you'll need a name, email, and password).
2. You'll land in a chat-style workspace. Just type what you need in plain English — for example, "audit my website" or "find keywords for a bakery in Austin, TX."
3. The system figures out which specialist should handle your request and replies — you don't need to know the agents' names or pick one yourself, though you can ask for a specific capability by name if you prefer.

## What you can ask for

- **"Audit my website"** — runs a real, automatic technical/SEO health check on any URL you give it (no need to connect anything first) and comes back with a prioritized list of issues and recommendations.
- **"Find keywords for [topic/business]"** or **"Write content about [topic]"** — triggers a multi-step process: real keyword research, followed by a written SEO strategy, real content generation, on-page recommendations, and (if it looks relevant) guest-posting ideas — all in one reply.
- **Questions about SEO strategy, competitors, technical issues, reporting, campaigns, and more** — the system will route your question to the right specialist automatically.
- **"Fix the issues you found"** (after an audit) — for real, connected-repository technical fixes, this starts a process that always stops for your explicit approval before anything is actually changed.

## Understanding a reply

Every reply is generated to be as accurate and current as possible. Two honest caveats worth knowing:

- **Some replies are grounded in real data the system just looked up** (e.g. real crawl results, real keyword data, your real connected Search Console numbers). Others are the AI's own well-informed writing, based on its detailed knowledge of that specialist's role, without a live tool behind that specific answer. The system is built to never claim it did something it didn't — if you're ever unsure whether a specific claim reflects a real action, you can ask directly, or an admin can check the technical documentation for that specialist.
- **The system will never make a real change to your live website, repository, or connected accounts without asking you to approve it first**, for anything that matters (a real code commit, a real deployment). If you see a request for approval, review it carefully — it is showing you the actual, exact change it wants to make, not a summary.

## Connecting your accounts (Settings → Integrations)

To unlock real, tool-backed capabilities, connect the relevant account under Settings → Integrations:
- **GitHub** — required for real technical fixes and real website-development changes.
- **WordPress** (self-hosted or WordPress.com) — for website content management.
- **Google Search Console** — for real search-performance data.
- **Bing Webmaster Tools**, **Google Business Profile**, **Google Sheets**, **Google Analytics**, **Google Drive** — for their respective real data.

If something isn't connected, the system will tell you clearly rather than guessing or making up data.

## Approving a real change

When the system proposes a real change (a technical fix, or a website-development change), you'll see the exact proposed change before deciding. You can approve or reject it. Approvals expire after a while — if you wait too long, you may need to ask the system to re-propose the change so it's working from the current state of your site.

## Getting help

If something seems wrong, or a reply doesn't make sense, see `docs/troubleshooting/TROUBLESHOOTING.md`, or contact your system administrator.
