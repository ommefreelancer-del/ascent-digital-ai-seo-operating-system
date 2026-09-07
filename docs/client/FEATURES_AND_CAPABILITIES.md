# Features & Capabilities

This page describes what you can actually get from the platform today, grouped by how solid the answer is — because being honest about that difference is a core design principle here, not an afterthought.

## Capabilities backed by real, live data or real actions

These involve the system actually looking something up, running a real check, or (with your approval) making a real change — not just writing about the topic from general knowledge.

- **Website audits** — a real, automatic crawl and technical/SEO health check of any URL you give it, no setup required. Comes back with a prioritized list of issues and recommendations.
- **Keyword research** — real keyword and search-intent data (when your account is configured for it) rather than a guess.
- **Content generation** — real, generated articles, landing pages, and meta content, including real images automatically attached, and a quality/originality check before it's handed to you.
- **Performance reporting** — real numbers from your connected Google Search Console and/or Bing Webmaster Tools accounts, when connected.
- **Competitor analysis** — real data gathered about a competitor's site, not a generic description.
- **Prospect discovery** (for link-building/guest-posting campaigns) — real search results and real, evidence-based prospect lists, with anything unconfirmed honestly labeled "not verified" rather than guessed.
- **Design asset search** — real, royalty-free stock image/video search results.
- **Technical fixes and website code changes** — for a connected repository, the system can propose and (only after your explicit approval) apply a real fix or change. See `client/APPROVALS_AND_HUMAN_CONTROL.md`.
- **Campaign tracking** — real, persisted tracking of a named campaign's progress.

## Capabilities that are expert guidance, not a live lookup

For these, you're getting the AI's well-informed writing on the topic — grounded in a detailed description of that specialist's role and whatever real information you've shared in the conversation — but not a real, independent tool running behind that specific reply. This is not a lesser feature; it's simply a different kind of answer, and the system is built to never claim it performed an action it didn't.

Examples: SEO strategy recommendations, competitor-intelligence discussion beyond a specific real lookup, business-development and outreach advice, CRM-style conversation summaries, publisher-qualification judgment calls, negotiation guidance, and general Q&A about SEO concepts.

If you're ever unsure which kind of answer you're getting for a specific reply, you can ask directly, or an administrator can check the technical documentation for that specific capability.

## Capabilities that require a connected account first

Some capabilities only produce real results once you've connected the relevant account under Settings → Integrations (see `client/GETTING_STARTED.md`): real search-performance data needs Google Search Console or Bing Webmaster Tools; real technical fixes and website changes need GitHub; website content management works through a connected WordPress account. Until connected, the system will say so plainly rather than fabricating a result.

## What's not available yet

The platform today is built around one account per customer, with a simple two-level permission model (a full-access role and a read-only role) rather than a full team/organization system with billing and multiple seats. If you're evaluating this for a larger team or multiple client organizations, ask your administrator — see `admin/SUBSCRIPTION_READINESS.md` for the honest, detailed picture.

## Related reading

- `client/AGENT_GUIDE.md` — what each of the 27 specialists focuses on.
- `client/WORKFLOW_GUIDE.md` — what happens step by step for the bigger requests.
- `client/INPUTS_AND_OUTPUTS.md` — exactly what to provide and what you'll get back.
