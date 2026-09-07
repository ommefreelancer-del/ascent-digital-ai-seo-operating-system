# Testing Reference

Audience: developer/engineer. Evidence: `.github/workflows/ci.yml`, `web/package.json` (both fully read).

## Test runner

**Vitest** (`vitest run`, `web/package.json` devDependency `^2.1.9`) — `npm test` under `web/`. The root package (`adasos-boss-agent`) has its own `npm test` script (confirmed via CI's `backend` job); its exact runner was not independently re-confirmed — check root `package.json` directly.

## CI pipeline (`.github/workflows/ci.yml`)

Runs on every push/PR to `main`. Two sequential jobs:

1. **`backend`** — `npm ci` → `npm run typecheck` → `npm run build` → `npm test` (root).
2. **`web`** (depends on `backend` passing) — rebuilds root → installs `web/` deps → `npm run typecheck` → `npm test` → **Validate startup**: writes a CI-only `.env` (placeholder secrets), `npx prisma db push`, `node scripts/validate-startup.mjs`.

The CI file's own header states its purpose: before it existed, "every regression test added to this repo... ran only when someone remembered to run `npm test` locally" — this workflow makes "the application must fail CI if a regression returns" actually enforced.

## `validate-startup.mjs`

Reads `web/.env` directly off disk (before Next.js's own env loading) and enforces production-safety checks, including the `NEXTAUTH_SECRET` production-strength check as a build-time second layer alongside `auth.ts`'s own runtime check. Runs with `--production` during `prebuild`.

## Confirmed real test references (from code comments)

`routing-matrix.integration.test.ts` (Boss Agent routing matrix) is referenced directly in `ci.yml`'s own header comment. Google Search Console OAuth and specialist-pipeline tests are referenced generically in the same comment.

## NOT VERIFIED IN CURRENT CODEBASE

- Exact test file inventory / coverage percentage for either package.
- Whether the two safety-critical real pipelines (Technical Remediation's GitHub write, Web Development Agent's commit) have dedicated integration tests beyond CI's generic `npm test` step.
- Whether `next lint` (`web/package.json`'s `lint` script) is enforced anywhere in CI — `ci.yml` does not appear to invoke it as a separate step.

## Where to modify

- Root tests: root `package.json`'s `test` script.
- Web tests: `web/package.json`'s `test` script (`vitest run`).
- CI: `.github/workflows/ci.yml`.
- Startup validation: `web/scripts/validate-startup.mjs`.
