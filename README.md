# ADASOS Boss Agent

Production implementation of the Boss Agent orchestration and routing
framework for the Ascent Digital AI SEO Operating System (ADASOS), as
specified in [`Agents/BossAgent.md`](Agents/BossAgent.md) and governed by
[`GLOBAL_RULES.md`](GLOBAL_RULES.md), [`docs/governance/ENGINEERING_STANDARDS.md`](docs/governance/ENGINEERING_STANDARDS.md),
and [`docs/governance/DevelopmentWorkflow.md`](docs/governance/DevelopmentWorkflow.md).

## Scope of this milestone

This build implements **only** the Boss Agent's orchestration and routing
framework:

- Loading and parsing every specialist agent spec in `Agents/*.md`.
- Deciding, for each task, which specialist agent's stated responsibilities
  best match it (deterministic keyword-based scoring — no LLM calls).
- Escalating ambiguous, low-confidence, or unmatched tasks to a human
  reviewer via an interactive CLI prompt, instead of guessing.
- Recording every decision to an audit log and persisting each run's outcome.

**No specialist agent is executed.** The output of a run is a routing
decision (which agent a task *would* go to, or that a human rejected it) —
never the specialist agent's actual work product. No specialist agent logic
or module is implemented here.

## Requirements

- Node.js >= 18.18.0

## Setup

```bash
npm install
npm run build
```

## Running

```bash
npm start -- "Improve organic rankings for the /pricing page" "Audit site speed on mobile"
```

Each argument is one task description. Add `--agents-dir <path>` to point at
a different specs directory than the repository's `Agents/` folder. Run with
`--help` for usage.

If a task cannot be routed automatically, the CLI will pause and ask you to
either pick a candidate agent by index or type `reject`.

## Configuration

All configuration has a working default and can be overridden with an
environment variable — no secrets are required (routing makes no external
API calls):

| Environment variable                    | Default                              | Meaning                                      |
| ---------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `BOSS_AGENT_AGENTS_DIR`                  | `<cwd>/Agents`                        | Directory containing `Agents/*.md`             |
| `BOSS_AGENT_STATE_DIR`                   | `<cwd>/var/boss-agent/state`          | Where per-run outcomes are persisted           |
| `BOSS_AGENT_AUDIT_LOG`                   | `<cwd>/var/boss-agent/audit-log.jsonl`| Append-only audit trail                        |
| `BOSS_AGENT_AUTO_ASSIGN_THRESHOLD`       | `0.5`                                 | Minimum score to auto-assign                   |
| `BOSS_AGENT_TIE_MARGIN`                  | `0.1`                                 | Minimum lead over the runner-up to auto-assign |
| `BOSS_AGENT_MAX_CANDIDATES`              | `5`                                   | Candidates retained per decision               |

## Testing

```bash
npm test
npm run typecheck
```

Verified: `npm run build`, `npm test` (68 tests), and `npm run typecheck` all pass.

## Module layout

```
src/
  core/           Cross-cutting infrastructure (persistence, audit logging,
                   human-approval channel). Reusable by future agents.
  boss-agent/      This milestone: registry, routing, governance, state,
                   config, and the BossAgent facade.
  cli.ts           Entry point (one run per process invocation).
tests/             Mirrors src/, one test file per module.
```
