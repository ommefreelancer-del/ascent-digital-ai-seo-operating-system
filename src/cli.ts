#!/usr/bin/env node
// CLI entry point: one Boss Agent run per process invocation. Each
// positional argument is treated as one task description; the process
// prints the routing decision for every task and exits. This matches the
// chosen "CLI script, one objective per run" invocation model — there is no
// long-running server in this build.
//
// Lifecycle is managed through BossOrchestrator (start -> run -> stop)
// rather than calling BossAgent directly, so that a run interrupted while
// blocked on a human approval prompt (SIGINT/SIGTERM) still records a
// matching "orchestrator_stopped" audit event instead of just vanishing.

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { BossOrchestrator } from "./boss-agent/boss-orchestrator.js";
import type { RunSummary } from "./boss-agent/boss-agent.js";
import { loadBossAgentConfig } from "./boss-agent/config/boss-agent.config.js";
import type { TaskInput } from "./boss-agent/types/task.types.js";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "agents-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    return;
  }

  if (positionals.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const agentsDirOverride = values["agents-dir"];
  const config = loadBossAgentConfig(
    agentsDirOverride ? { agentsDirectory: agentsDirOverride } : {},
  );

  const tasks: readonly TaskInput[] = positionals.map((description) => ({
    id: randomUUID(),
    description,
    priority: "normal",
  }));

  const orchestrator = await BossOrchestrator.create(config);
  registerShutdownHandlers(orchestrator);

  await orchestrator.start();
  try {
    const summary = await orchestrator.run(tasks);
    printSummary(summary);
  } finally {
    await orchestrator.stop();
  }
}

/**
 * Ensures Ctrl-C / a termination signal during a run (most likely while
 * blocked on a human approval prompt) still calls stop() -- so the audit
 * trail records a clean shutdown instead of the process just disappearing.
 * Node suppresses its default terminate-on-signal behavior once a listener
 * is registered, so this must exit the process itself once stop() settles.
 */
function registerShutdownHandlers(orchestrator: BossOrchestrator): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stderr.write(`\nReceived ${signal}, shutting down...\n`);
    orchestrator
      .stop()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        process.stderr.write(`Error while shutting down: ${String(error)}\n`);
        process.exit(1);
      });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

function printUsage(): void {
  process.stdout.write(
    "Usage: boss-agent <task description> [<task description> ...]\n\n" +
      "Each argument is routed to the specialist agent whose Agents/*.md spec\n" +
      "best matches it. No specialist agent is executed -- only the routing\n" +
      "decision is produced and recorded.\n\n" +
      "Options:\n" +
      "  --agents-dir <path>  Override the directory containing Agents/*.md specs\n" +
      "  -h, --help           Show this help message\n",
  );
}

function printSummary(summary: RunSummary): void {
  process.stdout.write(`\nRun ${summary.runId} complete. ${summary.outcomes.length} task(s) routed:\n\n`);
  for (const { task, decision } of summary.outcomes) {
    process.stdout.write(`- [${task.priority}] "${task.description}"\n`);
    process.stdout.write(
      `  status: ${decision.status}${decision.assignedAgentId ? ` -> ${decision.assignedAgentId}` : ""}\n`,
    );
    process.stdout.write(`  rationale: ${decision.rationale}\n\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Boss Agent failed: ${message}\n`);
  process.exitCode = 1;
});
