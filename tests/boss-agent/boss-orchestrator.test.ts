import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BossOrchestrator } from "../../src/boss-agent/boss-orchestrator.js";
import { BossAgent } from "../../src/boss-agent/boss-agent.js";
import { AuditLogger } from "../../src/core/governance/audit-logger.js";
import { ComplianceValidator } from "../../src/boss-agent/governance/compliance-validator.js";
import { EscalationHandler } from "../../src/boss-agent/governance/escalation-handler.js";
import { KeywordMatchRoutingStrategy } from "../../src/boss-agent/routing/keyword-match-routing-strategy.js";
import { TaskRouter } from "../../src/boss-agent/routing/task-router.js";
import { TaskStateStore } from "../../src/boss-agent/state/task-state-store.js";
import type { ApprovalChannel } from "../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../src/core/types/approval.types.js";
import type { AgentDirectory } from "../../src/boss-agent/registry/agent-registry.js";
import type { AgentSpec } from "../../src/boss-agent/types/agent-spec.types.js";
import type { BossAgentConfig } from "../../src/boss-agent/config/boss-agent.config.js";
import type { TaskInput } from "../../src/boss-agent/types/task.types.js";

const KEYWORD_AGENT_SPEC = `# Keyword Research Agent

## Mission
Identify high-value keywords.

## Responsibilities
- Perform keyword research.

## Inputs
- Business objectives

## Outputs
- Keyword report

## Communicates With
Receives: Boss Agent

Sends: SEO Strategy Agent

## Tools
- Ahrefs

## Rules
- Follow GLOBAL_RULES.md.
`;

const OUTREACH_AGENT_SPEC = `# Outreach Agent

## Mission
Send outreach communications to publishers.

## Responsibilities
- Send outreach emails to publishers.

## Inputs
- Prospect list

## Outputs
- Sent emails log

## Communicates With
Receives: Boss Agent

Sends: Reply Negotiation Agent

## Tools
- Gmail

## Rules
- Follow GLOBAL_RULES.md.
`;

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

async function readEventTypes(auditLogPath: string): Promise<string[]> {
  const raw = await readFile(auditLogPath, "utf8").catch(() => "");
  return raw
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line).eventType);
}

describe("BossOrchestrator", () => {
  let dir: string;

  beforeEach(async () => {
    // The fixture *.md files live directly in the temp root and double as
    // agentsDirectory; state/audit-log paths are separate subpaths under the
    // same root, auto-created on first write. AgentRegistry only reads *.md
    // files, so the non-.md subpaths written elsewhere in these tests don't
    // interfere with it.
    dir = await mkdtemp(join(tmpdir(), "boss-orchestrator-"));
    await writeFile(join(dir, "keyword-research-agent.md"), KEYWORD_AGENT_SPEC, "utf8");
    await writeFile(join(dir, "outreach-agent.md"), OUTREACH_AGENT_SPEC, "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Partial<BossAgentConfig> = {}): BossAgentConfig {
    return {
      agentsDirectory: dir,
      stateDirectory: join(dir, "state"),
      auditLogPath: join(dir, "audit-log.jsonl"),
      autoAssignThreshold: 0.5,
      tieMargin: 0.1,
      maxCandidates: 5,
      ...overrides,
    };
  }

  describe("create()", () => {
    it("wires a working orchestrator from config, loading the real agent registry from disk", async () => {
      const orchestrator = await BossOrchestrator.create(makeConfig());

      expect([...orchestrator.availableAgentIds()].sort()).toEqual([
        "keyword-research-agent",
        "outreach-agent",
      ]);
    });

    it("propagates a registry load failure instead of masking it", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "boss-orchestrator-empty-"));
      try {
        await expect(
          BossOrchestrator.create(makeConfig({ agentsDirectory: emptyDir })),
        ).rejects.toThrow();
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe("start()", () => {
    it("is idempotent: calling it twice logs only one orchestrator_started event", async () => {
      const config = makeConfig();
      const orchestrator = await BossOrchestrator.create(config);

      await orchestrator.start();
      await orchestrator.start();

      const eventTypes = await readEventTypes(config.auditLogPath);
      expect(eventTypes.filter((type) => type === "orchestrator_started")).toHaveLength(1);
    });

    it("unblocks run(), which otherwise rejects", async () => {
      const config = makeConfig();
      const orchestrator = await BossOrchestrator.create(config);
      const task: TaskInput = { id: "task-1", description: "Perform keyword research", priority: "normal" };

      await expect(orchestrator.run([task])).rejects.toThrow(
        "BossOrchestrator.start() must be called before running tasks.",
      );

      await orchestrator.start();

      await expect(orchestrator.run([task])).resolves.toBeDefined();
    });
  });

  describe("stop()", () => {
    it("is idempotent: calling it twice after start() logs only one orchestrator_stopped event", async () => {
      const config = makeConfig();
      const orchestrator = await BossOrchestrator.create(config);
      await orchestrator.start();

      await orchestrator.stop();
      await orchestrator.stop();

      const eventTypes = await readEventTypes(config.auditLogPath);
      expect(eventTypes.filter((type) => type === "orchestrator_stopped")).toHaveLength(1);
    });

    it("is a no-op (logs nothing) when called before start() was ever called", async () => {
      const config = makeConfig();
      const orchestrator = await BossOrchestrator.create(config);

      await orchestrator.stop();

      const eventTypes = await readEventTypes(config.auditLogPath);
      expect(eventTypes).toEqual([]);
    });
  });

  describe("run()", () => {
    function buildOrchestratorWithRealBossAgent(
      registry: AgentDirectory,
      approvalDecision: ApprovalDecision,
    ): BossOrchestrator {
      const strategy = new KeywordMatchRoutingStrategy();
      const router = new TaskRouter(registry, strategy, {
        autoAssignThreshold: 0.5,
        tieMargin: 0.1,
        maxCandidates: 5,
      });
      const auditLogger = new AuditLogger(join(dir, "delegation-audit-log.jsonl"));
      const approvalChannel: ApprovalChannel = { requestDecision: async () => approvalDecision };
      const escalationHandler = new EscalationHandler(approvalChannel, auditLogger);
      const bossAgent = new BossAgent(
        registry,
        router,
        new ComplianceValidator(),
        escalationHandler,
        auditLogger,
        new TaskStateStore(join(dir, "delegation-state")),
      );
      return new BossOrchestrator(bossAgent, auditLogger);
    }

    it("throws before start() without ever consulting the underlying BossAgent", async () => {
      const registry = makeDirectory([
        makeSpec("keyword-research-agent", "Keyword Research Agent", ["Perform keyword research."]),
      ]);
      const orchestrator = buildOrchestratorWithRealBossAgent(registry, {
        requestId: "unused",
        outcome: "rejected",
        notes: "n/a",
        decidedAt: new Date().toISOString(),
      });

      const task: TaskInput = { id: "task-1", description: "Perform keyword research", priority: "normal" };

      await expect(orchestrator.run([task])).rejects.toThrow(
        "BossOrchestrator.start() must be called before running tasks.",
      );
    });

    it("delegates routing to the underlying BossAgent once started, returning its exact result", async () => {
      const registry = makeDirectory([
        makeSpec("keyword-research-agent", "Keyword Research Agent", ["Perform keyword research."]),
        makeSpec("outreach-agent", "Outreach Agent", ["Send outreach emails."]),
      ]);
      const orchestrator = buildOrchestratorWithRealBossAgent(registry, {
        requestId: "unused",
        outcome: "rejected",
        notes: "n/a",
        decidedAt: new Date().toISOString(),
      });

      await orchestrator.start();
      const task: TaskInput = { id: "task-1", description: "Perform keyword research", priority: "normal" };
      const summary = await orchestrator.run([task]);

      expect(summary.outcomes).toHaveLength(1);
      expect(summary.outcomes[0]?.decision.status).toBe("assigned");
      expect(summary.outcomes[0]?.decision.assignedAgentId).toBe("keyword-research-agent");
    });
  });

  describe("availableAgentIds()", () => {
    it("passes through the underlying BossAgent's routable agent ids", async () => {
      const registry = makeDirectory([
        makeSpec("technical-seo-agent", "Technical SEO Agent", ["placeholder"]),
        makeSpec("off-page-seo-agent", "Off-Page SEO Agent", ["placeholder"]),
      ]);
      const auditLogger = new AuditLogger(join(dir, "ids-audit-log.jsonl"));
      const bossAgent = new BossAgent(
        registry,
        new TaskRouter(registry, new KeywordMatchRoutingStrategy(), {
          autoAssignThreshold: 0.5,
          tieMargin: 0.1,
          maxCandidates: 5,
        }),
        new ComplianceValidator(),
        new EscalationHandler({ requestDecision: async () => ({
          requestId: "unused",
          outcome: "rejected",
          notes: "n/a",
          decidedAt: new Date().toISOString(),
        }) }, auditLogger),
        auditLogger,
        new TaskStateStore(join(dir, "ids-state")),
      );
      const orchestrator = new BossOrchestrator(bossAgent, auditLogger);

      expect([...orchestrator.availableAgentIds()].sort()).toEqual([
        "off-page-seo-agent",
        "technical-seo-agent",
      ]);
    });
  });
});
