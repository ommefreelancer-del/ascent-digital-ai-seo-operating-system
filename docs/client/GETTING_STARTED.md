# Getting Started

## Signing in

Go to the app's web address and sign in, or create an account if this is your first time — you'll need a name, email, and password.

## Your first request

You'll land in a chat-style workspace. Type what you need in plain English — for example:

- "Audit my website"
- "Find keywords for a bakery in Austin, TX"
- "Write a blog post about sustainable packaging"
- "How is my site performing in search this month?"

The system figures out which specialist should handle your request and replies. You don't need to know the specialists' names or pick one yourself, though you can ask for a specific capability by name if you prefer (see `client/AGENT_GUIDE.md` for the full list of what's available).

## Connecting your accounts

Some capabilities need access to one of your real accounts to give you real, current data or to make a real change. You connect these under **Settings → Integrations**:

- **GitHub** — required for real technical fixes and real website-development changes to be applied to your site's repository.
- **WordPress** (self-hosted or WordPress.com) — for website content management.
- **Google Search Console** — for real search-performance data.
- **Bing Webmaster Tools**, **Google Business Profile**, **Google Sheets**, **Google Analytics**, **Google Drive** — for their respective real data.

If something isn't connected yet, the system will tell you clearly rather than guessing or making up data. You can always come back and connect an account later — most capabilities work fine without every integration connected; you'll just get advisory guidance instead of live data for that specific topic until you do.

## A simple first session

1. Ask for a website audit on a site you own or manage.
2. Review the findings — you'll get a prioritized list of issues.
3. Ask a follow-up like "explain the second issue" or "fix the issues you found."
4. If a fix requires a real change to your site, you'll be shown the exact proposed change and asked to approve or reject it before anything happens — see `client/APPROVALS_AND_HUMAN_CONTROL.md`.

## Next steps

Once you're comfortable with the basics, `client/FEATURES_AND_CAPABILITIES.md` covers the full range of what you can ask for, and `client/WORKFLOW_GUIDE.md` explains what happens behind the scenes for the bigger, multi-step requests like content generation.
