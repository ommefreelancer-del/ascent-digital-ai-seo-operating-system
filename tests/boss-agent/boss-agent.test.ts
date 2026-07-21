import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BossAgent } from "../../src/boss-agent/boss-agent.js";
import { AuditLogger } from "../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../src/core/types/approval.types.js";
import { ComplianceValidator } from "../../src/boss-agent/governance/compliance-validator.js";
import { EscalationHandler } from "../../src/boss-agent/governance/escalation-handler.js";
import { KeywordMatchRoutingStrategy } from "../../src/boss-agent/routing/keyword-match-routing-strategy.js";
import { TaskRouter } from "../../src/boss-agent/routing/task-router.js";
import { TaskStateStore } from "../../src/boss-agent/state/task-state-store.js";
import type { AgentDirectory } from "../../src/boss-agent/registry/agent-registry.js";
import type { AgentSpec } from "../../src/boss-agent/types/agent-spec.types.js";
import type { TaskInput } from "../../src/boss-agent/types/task.types.js";

function makeSpec(id: string, title: string, responsibilities: string[]): AgentSpec {
  return {
    id,
    sourcePath: `/Agents/${id}.md`,
    title,
    mission: "",
    responsibilities,
    inputs: [],
    outputs: [],
    communicatesWith: { receives: [], sends: [] },
    tools: [],
    rules: [],
    successCriteria: [],
  };
}

function makeDirectory(specs: AgentSpec[]): AgentDirectory {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return {
    list: () => specs,
    getById: (id) => byId.get(id),
    has: (id) => byId.has(id),
    size: () => specs.length,
  };
}

describe("BossAgent (integration)", () => {
  let dir: string;
  let registry: AgentDirectory;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "boss-agent-integration-"));
    registry = makeDirectory([
      makeSpec("keyword-research-agent", "Keyword Research Agent", [
        "Perform comprehensive keyword research and search intent analysis.",
      ]),
      makeSpec("outreach-agent", "Outreach Agent", ["Send outreach emails to publishers."]),
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildBossAgent(approvalDecision: ApprovalDecision): BossAgent {
    const strategy = new KeywordMatchRoutingStrategy();
    const router = new TaskRouter(registry, strategy, {
      autoAssignThreshold: 0.5,
      tieMargin: 0.1,
      maxCandidates: 5,
    });
    const auditLogger = new AuditLogger(join(dir, "audit-log.jsonl"));
    const approvalChannel: ApprovalChannel = { requestDecision: async () => approvalDecision };
    const escalationHandler = new EscalationHandler(approvalChannel, auditLogger);
    const complianceValidator = new ComplianceValidator();
    const taskStateStore = new TaskStateStore(join(dir, "state"));

    return new BossAgent(registry, router, complianceValidator, escalationHandler, auditLogger, taskStateStore);
  }

  it("auto-assigns a clearly matching task without consulting a human", async () => {
    let approvalWasRequested = false;
    const strategy = new KeywordMatchRoutingStrategy();
    const router = new TaskRouter(registry, strategy, {
      autoAssignThreshold: 0.5,
      tieMargin: 0.1,
      maxCandidates: 5,
    });
    const auditLogger = new AuditLogger(join(dir, "audit-log.jsonl"));
    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        approvalWasRequested = true;
        throw new Error("should not be called for a clear match");
      },
    };
    const escalationHandler = new EscalationHandler(approvalChannel, auditLogger);
    const boss = new BossAgent(
      registry,
      router,
      new ComplianceValidator(),
      escalationHandler,
      auditLogger,
      new TaskStateStore(join(dir, "state")),
    );

    const task: TaskInput = { id: "task-1", description: "Perform keyword research", priority: "normal" };
    const summary = await boss.run([task]);

    expect(summary.outcomes).toHaveLength(1);
    expect(summary.outcomes[0]?.decision.status).toBe("assigned");
    expect(summary.outcomes[0]?.decision.assignedAgentId).toBe("keyword-research-agent");
    expect(approvalWasRequested).toBe(false);
  });

  it("escalates an ambiguous task to the approval channel and finalizes with its decision", async () => {
    const bossAgent = buildBossAgent({
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "outreach-agent",
      notes: "Human confirmed outreach-agent.",
      decidedAt: new Date().toISOString(),
    });

    const task: TaskInput = { id: "task-2", description: "Do something vague", priority: "normal" };
    const summary = await bossAgent.run([task]);

    expect(summary.outcomes[0]?.decision.status).toBe("assigned");
    expect(summary.outcomes[0]?.decision.assignedAgentId).toBe("outreach-agent");
    expect(summary.outcomes[0]?.decision.rationale).toBe("Human confirmed outreach-agent.");
  });

  it("processes high-priority tasks before normal-priority tasks", async () => {
    const bossAgent = buildBossAgent({
      requestId: "unused",
      outcome: "rejected",
      notes: "n/a",
      decidedAt: new Date().toISOString(),
    });

    const tasks: TaskInput[] = [
      { id: "normal-task", description: "Perform keyword research", priority: "normal" },
      { id: "high-task", description: "Send outreach emails", priority: "high" },
    ];

    const summary = await bossAgent.run(tasks);

    expect(summary.outcomes[0]?.task.id).toBe("high-task");
    expect(summary.outcomes[1]?.task.id).toBe("normal-task");
  });

  it("persists the run so it can be loaded back by runId", async () => {
    const bossAgent = buildBossAgent({
      requestId: "unused",
      outcome: "rejected",
      notes: "n/a",
      decidedAt: new Date().toISOString(),
    });

    const task: TaskInput = { id: "task-1", description: "Perform keyword research", priority: "normal" };
    const summary = await bossAgent.run([task]);

    const taskStateStore = new TaskStateStore(join(dir, "state"));
    const loaded = await taskStateStore.loadRun(summary.runId);

    expect(loaded?.outcomes).toHaveLength(1);
    expect(loaded?.outcomes[0]?.decision.assignedAgentId).toBe("keyword-research-agent");
  });

  it("writes a task_received and routing_decided audit event for every task", async () => {
    const bossAgent = buildBossAgent({
      requestId: "unused",
      outcome: "rejected",
      notes: "n/a",
      decidedAt: new Date().toISOString(),
    });

    const task: TaskInput = { id: "task-1", description: "Perform keyword research", priority: "normal" };
    await bossAgent.run([task]);

    const lines = (await readFile(join(dir, "audit-log.jsonl"), "utf8")).trim().split("\n");
    const eventTypes = lines.map((line) => JSON.parse(line).eventType);
    expect(eventTypes).toEqual(["task_received", "routing_decided"]);
  });

  it("exposes the routable agent ids", async () => {
    const bossAgent = buildBossAgent({
      requestId: "unused",
      outcome: "rejected",
      notes: "n/a",
      decidedAt: new Date().toISOString(),
    });

    expect([...bossAgent.availableAgentIds()].sort()).toEqual(["keyword-research-agent", "outreach-agent"]);
  });
});
