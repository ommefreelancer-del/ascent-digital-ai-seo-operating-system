# Testing & Validation

Audience: admin / developer. Evidence: `.github/workflows/ci.yml` (fully read), `web/package.json` (fully read), root `package.json` (fully read). See `technical/TESTING_REFERENCE.md` for the developer-facing technical detail.

## Test runner

Vitest (`vitest run`, `web/package.json` devDependency `^2.1.9`) is the test runner for the web app (`npm test` under `web/`). The root backend package (`adasos-boss-agent`) also has its own `npm test` command (confirmed via CI's `backend` job) — its underlying runner was not independently re-confirmed in this pass; check root `package.json`'s own `test` script directly if needed.

## CI pipeline (`.github/workflows/ci.yml`)

Runs on every push and PR to `main`. Two sequential jobs:

1. **`backend`** — `npm ci` → `npm run typecheck` → `npm run build` → `npm test` (root package).
2. **`web`** (depends on `backend` passing first) — rebuilds root (`npm run build` at repo root, so `web`'s dynamic `dist/` import has fresh compiled output) → installs `web/` deps → `npm run typecheck` → `npm test` → **Validate startup**: writes a CI-only `.env` (placeholder `NEXTAUTH_SECRET`/`ANTHROPIC_API_KEY`, real-format `DATABASE_URL`), runs `npx prisma db push`, then `node scripts/validate-startup.mjs`.

Before this workflow existed, every regression test added to the repo ran only when someone remembered to run `npm test` locally — this workflow is what makes "the application must fail CI if a regression returns" actually enforced rather than aspirational.

## `validate-startup.mjs` — a real, meaningful gate

Referenced from multiple places (CI, `web/package.json`'s `predev`/`prebuild` hooks, `auth.ts`'s own comment). It reads `web/.env` directly off disk (deliberately not `process.env`, since it must run before Next.js's own env loading) and enforces production-safety checks — including the `NEXTAUTH_SECRET` production-strength check as a second, build-time layer of defense (the first being the runtime check inside `auth.ts` itself). Also runs with a `--production` flag during `prebuild`.

## Before trusting a change, run

1. `npm run typecheck` (root and/or `web/`, depending on what changed).
2. `npm test` in the relevant package — both packages must pass in CI per `ci.yml`.
3. `npm run health-check` (from `web/`) if the change could affect runtime health (PM2, port, database, required env vars).
4. For any change to an integration client: exercise it via `integration-health-check.ts` (Settings → Integrations, or equivalent tooling) — see `admin/INTEGRATION_CONFIGURATION.md`.
5. For any change to routing, agent dispatch, or a workflow: manually exercise the specific scenario end-to-end, per the "Testing required" column of the relevant row in `admin/MASTER_CHANGE_MAP.md`.

## Confirmed real test suite references (from code comments, not independently re-run in this pass)

- `routing-matrix.integration.test.ts` — referenced directly in `ci.yml`'s own header comment as an example of the regression test this CI enforces (Boss Agent routing matrix).
- Google Search Console OAuth and specialist-pipeline tests are also referenced generically in the same comment as existing regression coverage.

## NOT VERIFIED IN CURRENT CODEBASE (recorded, not guessed)

- The exact test file inventory and coverage percentage for either package — this pass located and read specific source files but did not exhaustively enumerate `web/tests/**` or root `tests/**` directory contents.
- Whether the two most safety-critical real pipelines (Technical Remediation's actual GitHub write, Web Development Agent's actual commit) have dedicated integration tests beyond what CI's generic `npm test` step runs — flagged in `agents/web-development-agent.md` and `agents/website-audit-agent.md` as an item to verify directly before trusting either pipeline against a real production repository.
- Linting: `web/package.json` defines `"lint": "next lint"`, but `ci.yml` does not appear to invoke it as a separate step — confirm whether lint is enforced elsewhere (e.g. a pre-commit hook) or not enforced in CI at all.

## Recommended next audit step

Run `find web/tests -type f` (or equivalent) and read the resulting file list before making any further claim about specific test coverage — this documentation pass verified the *existence and structure* of the testing pipeline, not the *completeness* of the test suite itself.

## Where to modify

- Root tests: root `package.json`'s `test` script and its target directory.
- Web tests: `web/package.json`'s `test` script (`vitest run`), test files under `web/`.
- CI pipeline: `.github/workflows/ci.yml`.
- Startup validation: `web/scripts/validate-startup.mjs`.
