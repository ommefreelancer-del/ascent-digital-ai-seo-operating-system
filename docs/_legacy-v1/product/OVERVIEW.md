# Product Overview

Audience: everyone — a plain-language starting point.

## What ADASOS is

ADASOS (Ascent Digital AI SEO Operating System), operated commercially as **SM Digital**, is an AI-powered SEO service delivery system built around 27 specialist AI agents coordinated by a central "Boss Agent." A user (an SEO agency, an in-house marketer, or the system's own operator) chats with the system, and Boss Agent routes each request to the specialist best suited to handle it — website audits, keyword research, content generation, technical SEO, competitor analysis, outreach/guest posting, reporting, and more.

## What makes it different from "just a chatbot"

Some of the 27 specialists don't just talk about SEO — they run real, working tools: a real website crawler and Lighthouse-based performance audit, real keyword/content generation persisted to a database, a real technical-fix pipeline that can (with explicit human approval) commit an actual fix to a connected GitHub repository, and a real website-development pipeline that can (again, only with explicit human approval) draft and commit real code changes to a connected site's repository. Other specialists currently answer in character, grounded in a detailed job-description-style spec but without a dedicated real tool behind them yet — this is documented transparently, agent by agent, in `docs/agents/`, rather than left ambiguous.

## The two things a new user should understand immediately

1. **ADASOS never makes a real, production-affecting change (a live commit, a live deployment) without a human explicitly approving it first.** This is a hard-enforced rule in the code, not just a policy statement — see `docs/security/HUMAN_APPROVAL_SYSTEM.md`.
2. **Not every specialist's chat reply reflects a real tool call yet.** ADASOS is built to be honest about this rather than pretend otherwise — a reply describing an action you didn't separately approve should be verified, not assumed. See `docs/user-guide/USER_GUIDE.md` and each agent's documentation for specifics.

## Who this documentation set is for

- **Client / end-user:** start with `docs/user-guide/USER_GUIDE.md`.
- **Owner / admin / developer:** start with `docs/admin/ADMIN_GUIDE.md` and `docs/admin/MASTER_CHANGE_MAP.md`.

## Current scale (verified)

27 specialist agents, one Boss Agent orchestrator, a Next.js/React web application, a SQLite database with 26 data models, and real integrations with GitHub, WordPress, Google Search Console, Bing Webmaster Tools, Google Analytics/Sheets/Business Profile/Drive, DataForSEO, Pixabay, Pexels, and Anthropic Claude (plus optional Google Gemini for one narrow content-writing seam).

## Current deployment reality

ADASOS currently runs as a single-operator, single-machine local deployment (Windows, PM2-managed) — see `docs/deployment/DEPLOYMENT_GUIDE.md`. It is not currently a multi-tenant, self-service SaaS product — see `docs/admin/SUBSCRIPTION_READINESS.md` for exactly what that would require.
