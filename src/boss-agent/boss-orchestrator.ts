/**
 * ============================================================
 * Boss Orchestrator
 * Ascent Digital AI SEO Operating System
 * ------------------------------------------------------------
 * Mission:
 * Coordinates all AI agents, manages workflows,
 * enforces global rules, and controls task execution.
 * ------------------------------------------------------------
 * This is a lifecycle shell around the existing BossAgent facade
 * (src/boss-agent/boss-agent.ts), which already wires AgentRegistry,
 * TaskRouter, ComplianceValidator, EscalationHandler, AuditLogger, and
 * TaskStateStore together for one-shot routing runs. BossOrchestrator adds
 * start()/stop() process lifecycle around that facade and records its own
 * lifecycle events to the same audit trail -- it does not duplicate any
 * routing or governance logic.
 * ============================================================
 */
import { BossAgent, type RunSummary } from "./boss-agent.js";
import type { BossAgentConfig } from "./config/boss-agent.config.js";
import type { TaskInput } from "./types/task.types.js";
import { AuditLogger } from "../core/governance/audit-logger.js";

export class BossOrchestrator {
    private started = false;

    constructor(
        private readonly bossAgent: BossAgent,
        private readonly auditLogger: AuditLogger,
    ) {}

    /**
     * Wires the production implementation: builds the underlying BossAgent
     * from config (loading the real agent registry from disk) and an
     * AuditLogger pointed at the same configured audit log file.
     */
    static async create(config: BossAgentConfig): Promise<BossOrchestrator> {
        const bossAgent = await BossAgent.create(config);
        const auditLogger = new AuditLogger(config.auditLogPath);
        return new BossOrchestrator(bossAgent, auditLogger);
    }

    /** Marks the orchestrator ready to accept work. Safe to call more than once. */
    public async start(): Promise<void> {
        if (this.started) {
            return;
        }
        this.started = true;
        await this.auditLogger.logEvent({
            actor: "boss-orchestrator",
            eventType: "orchestrator_started",
            details: { availableAgentIds: this.bossAgent.availableAgentIds() },
        });
    }

    /** Marks the orchestrator as no longer accepting work. Safe to call more than once. */
    public async stop(): Promise<void> {
        if (!this.started) {
            return;
        }
        this.started = false;
        await this.auditLogger.logEvent({
            actor: "boss-orchestrator",
            eventType: "orchestrator_stopped",
            details: {},
        });
    }

    /**
     * Routes every task via the underlying BossAgent. Requires start() to
     * have been called first, since a stopped orchestrator should not
     * silently accept work.
     */
    public async run(tasks: readonly TaskInput[]): Promise<RunSummary> {
        if (!this.started) {
            throw new Error("BossOrchestrator.start() must be called before running tasks.");
        }
        return this.bossAgent.run(tasks);
    }

    /** The specialist agents currently available for routing. */
    public availableAgentIds(): readonly string[] {
        return this.bossAgent.availableAgentIds();
    }
}