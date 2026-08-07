// The guest-posting / digital-PR business-development pipeline: Prospecting
// -> Publisher Qualification -> Contact Intelligence -> Outreach -> Campaign
// Tracking -> Reply & Negotiation -> Guest Posting & Digital PR
// (consolidation). Built on the same WorkflowEngine as
// seo-audit-workflow.ts/blog-generation-workflow.ts, reusing the real agent
// classes -- no business logic is duplicated here, this module only threads
// one agent's real result into the next agent's real request.
//
// Before this workflow existed, no runtime code anywhere in the repo
// actually chained these 7 agents together -- the type contracts lined up
// exactly (each request type imports and embeds its predecessor's real
// result type) but nothing called them in sequence. This is that missing
// glue, and nothing else: every field placed into a downstream request is a
// real value read off the upstream result, never invented here.
//
// Step order is the one the TYPE SYSTEM actually enforces, not the
// conventional shorthand ("Outreach -> Reply & Negotiation ->
// Campaign Tracking"): ReplyNegotiationRequest requires a real
// CampaignTrackingResult, and CampaignTrackingRequest requires only a real
// OutreachResult -- so Campaign Tracking must run before Reply &
// Negotiation, not after.
//
// GLOBAL_RULES.md SS9 is unaffected by this workflow: it never sends an
// email, never agrees to pricing, never writes to a spreadsheet or CRM --
// it only calls each agent's own real method, and every agent involved
// already enforces its own approval/escalation rules internally (declined
// escalations propagate as this workflow halting, exactly like
// blog-generation-workflow.ts's publish-approval step). With no real
// provider supplied for prospect discovery, publisher quality, contact
// discovery, or publisher replies, every stage honestly reports
// `dataAvailable: false` and empty lists -- this workflow never fabricates
// activity to make the pipeline look more complete than it is.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ApprovalChannel } from "../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../core/governance/audit-logger.js";
import { WorkflowEngine } from "../core/workflow/workflow-engine.js";
import type { WorkflowContext, WorkflowRunResult, WorkflowStep } from "../core/workflow/workflow-step.types.js";

import { ProspectingAgent } from "../agents/prospecting-agent/prospecting-agent.js";
import { loadProspectingAgentConfig } from "../agents/prospecting-agent/config/prospecting-agent.config.js";
import type { ProspectDiscoveryProvider } from "../agents/prospecting-agent/types/prospect-discovery-provider.types.js";
import { NullProspectDiscoveryProvider } from "../agents/prospecting-agent/providers/null-prospect-discovery-provider.js";
import type { ProspectingResult } from "../agents/prospecting-agent/types/prospecting-request.types.js";

import { PublisherQualificationAgent } from "../agents/publisher-qualification-agent/publisher-qualification-agent.js";
import { loadPublisherQualificationAgentConfig } from "../agents/publisher-qualification-agent/config/publisher-qualification-agent.config.js";
import type { PublisherQualityProvider } from "../agents/publisher-qualification-agent/types/publisher-quality-provider.types.js";
import { NullPublisherQualityProvider } from "../agents/publisher-qualification-agent/providers/null-publisher-quality-provider.js";
import type { PublisherQualificationResult } from "../agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";

import { ContactIntelligenceAgent } from "../agents/contact-intelligence-agent/contact-intelligence-agent.js";
import { loadContactIntelligenceAgentConfig } from "../agents/contact-intelligence-agent/config/contact-intelligence-agent.config.js";
import type { ContactDiscoveryProvider } from "../agents/contact-intelligence-agent/types/contact-discovery-provider.types.js";
import { NullContactDiscoveryProvider } from "../agents/contact-intelligence-agent/providers/null-contact-discovery-provider.js";
import type { ContactIntelligenceResult } from "../agents/contact-intelligence-agent/types/contact-intelligence-request.types.js";

import { OutreachAgent } from "../agents/outreach-agent/outreach-agent.js";
import { loadOutreachAgentConfig } from "../agents/outreach-agent/config/outreach-agent.config.js";
import type { OutreachResult } from "../agents/outreach-agent/types/outreach-request.types.js";

import { CampaignTrackingAgent } from "../agents/campaign-tracking-agent/campaign-tracking-agent.js";
import { loadCampaignTrackingAgentConfig } from "../agents/campaign-tracking-agent/config/campaign-tracking-agent.config.js";
import type { CampaignTrackingResult, CampaignUpdateEntry } from "../agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";

import { ReplyNegotiationAgent } from "../agents/reply-negotiation-agent/reply-negotiation-agent.js";
import { loadReplyNegotiationAgentConfig } from "../agents/reply-negotiation-agent/config/reply-negotiation-agent.config.js";
import type { PublisherReplyProvider } from "../agents/reply-negotiation-agent/types/publisher-reply-provider.types.js";
import { NullPublisherReplyProvider } from "../agents/reply-negotiation-agent/providers/null-publisher-reply-provider.js";
import type { ReplyNegotiationResult, TargetPricing } from "../agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

import { GuestPostingDigitalPrAgent } from "../agents/guest-posting-digital-pr-agent/guest-posting-digital-pr-agent.js";
import { loadGuestPostingDigitalPrAgentConfig } from "../agents/guest-posting-digital-pr-agent/config/guest-posting-digital-pr-agent.config.js";
import type { GuestPostingDigitalPrResult } from "../agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";

export interface GuestPostingPipelineWorkflowInput {
  readonly campaignName: string;
  readonly campaignRequirements: string;
  readonly targetNiche: string;
  readonly targetCountry: string;
  readonly targetLanguage: string;
  readonly targetPricing: TargetPricing;
  readonly userInstructions?: string;
  readonly senderName?: string;
  readonly businessRules?: string;
  readonly campaignUpdates?: readonly CampaignUpdateEntry[];
}

export interface GuestPostingPipelineWorkflowProviders {
  readonly prospectDiscoveryProvider?: ProspectDiscoveryProvider;
  readonly publisherQualityProvider?: PublisherQualityProvider;
  readonly contactDiscoveryProvider?: ContactDiscoveryProvider;
  readonly publisherReplyProvider?: PublisherReplyProvider;
}

interface PipelineAgents {
  readonly prospectingAgent: ProspectingAgent;
  readonly publisherQualificationAgent: PublisherQualificationAgent;
  readonly contactIntelligenceAgent: ContactIntelligenceAgent;
  readonly outreachAgent: OutreachAgent;
  readonly campaignTrackingAgent: CampaignTrackingAgent;
  readonly replyNegotiationAgent: ReplyNegotiationAgent;
  readonly guestPostingDigitalPrAgent: GuestPostingDigitalPrAgent;
}

export function buildGuestPostingPipelineWorkflowSteps(
  input: GuestPostingPipelineWorkflowInput,
  agents: PipelineAgents,
): WorkflowStep[] {
  const runId = randomUUID();

  return [
    {
      id: "prospecting",
      name: "Prospecting Agent: discover candidate websites",
      async run(ctx: WorkflowContext) {
        const result = await agents.prospectingAgent.discoverProspects({
          id: `${runId}:prospecting`,
          campaignRequirements: input.campaignRequirements,
          targetNiche: input.targetNiche,
          targetCountry: input.targetCountry,
          targetLanguage: input.targetLanguage,
          ...(input.userInstructions !== undefined && { userInstructions: input.userInstructions }),
        });
        ctx.set("prospecting", result);
        return { outcome: "completed" };
      },
    },
    {
      id: "publisher-qualification",
      name: "Publisher Qualification Agent: evaluate discovered prospects",
      async run(ctx: WorkflowContext) {
        const prospecting = ctx.get("prospecting") as ProspectingResult;
        const result = await agents.publisherQualificationAgent.qualifyProspects({
          id: `${runId}:publisher-qualification`,
          prospecting,
          campaignRequirements: input.campaignRequirements,
          targetNiche: input.targetNiche,
          ...(input.userInstructions !== undefined && { userInstructions: input.userInstructions }),
        });
        ctx.set("publisherQualification", result);
        return { outcome: "completed" };
      },
    },
    {
      id: "contact-intelligence",
      name: "Contact Intelligence Agent: find publisher contact information",
      async run(ctx: WorkflowContext) {
        const publisherQualification = ctx.get("publisherQualification") as PublisherQualificationResult;
        const result = await agents.contactIntelligenceAgent.gatherContacts({
          id: `${runId}:contact-intelligence`,
          publisherQualification,
          campaignRequirements: input.campaignRequirements,
        });
        ctx.set("contactIntelligence", result);
        return { outcome: "completed" };
      },
    },
    {
      id: "outreach",
      name: "Outreach Agent: draft personalized outreach",
      async run(ctx: WorkflowContext) {
        const publisherQualification = ctx.get("publisherQualification") as PublisherQualificationResult;
        const contactIntelligence = ctx.get("contactIntelligence") as ContactIntelligenceResult;
        const result = await agents.outreachAgent.prepareOutreach({
          id: `${runId}:outreach`,
          publisherQualification,
          contactIntelligence,
          campaignRequirements: input.campaignRequirements,
          ...(input.senderName !== undefined && { senderName: input.senderName }),
        });
        ctx.set("outreach", result);
        return { outcome: "completed" };
      },
    },
    {
      id: "campaign-tracking",
      name: "Campaign Tracking Agent: record campaign status",
      async run(ctx: WorkflowContext) {
        const outreach = ctx.get("outreach") as OutreachResult;
        const result = await agents.campaignTrackingAgent.trackCampaign({
          id: `${runId}:campaign-tracking`,
          campaignName: input.campaignName,
          outreach,
          ...(input.campaignUpdates !== undefined && { campaignUpdates: input.campaignUpdates }),
        });
        ctx.set("campaignTracking", result);
        return { outcome: "completed" };
      },
    },
    {
      id: "reply-negotiation",
      name: "Reply & Negotiation Agent: manage publisher replies and pricing",
      async run(ctx: WorkflowContext) {
        const outreach = ctx.get("outreach") as OutreachResult;
        const campaignTracking = ctx.get("campaignTracking") as CampaignTrackingResult;
        const result = await agents.replyNegotiationAgent.manageNegotiations({
          id: `${runId}:reply-negotiation`,
          outreach,
          campaignTracking,
          targetPricing: input.targetPricing,
          ...(input.businessRules !== undefined && { businessRules: input.businessRules }),
          ...(input.userInstructions !== undefined && { userInstructions: input.userInstructions }),
          ...(input.senderName !== undefined && { senderName: input.senderName }),
        });
        ctx.set("replyNegotiation", result);
        return { outcome: "completed" };
      },
    },
    {
      id: "guest-posting-consolidation",
      name: "Guest Posting & Digital PR Agent: consolidate the campaign",
      async run(ctx: WorkflowContext) {
        const prospecting = ctx.get("prospecting") as ProspectingResult;
        const publisherQualification = ctx.get("publisherQualification") as PublisherQualificationResult;
        const outreach = ctx.get("outreach") as OutreachResult;
        const campaignTracking = ctx.get("campaignTracking") as CampaignTrackingResult;
        const replyNegotiation = ctx.get("replyNegotiation") as ReplyNegotiationResult;
        const result = await agents.guestPostingDigitalPrAgent.manageGuestPostingDigitalPr({
          id: `${runId}:guest-posting-consolidation`,
          campaignName: input.campaignName,
          prospecting,
          publisherQualification,
          outreach,
          campaignTracking,
          replyNegotiation,
        });
        ctx.set("guestPostingDigitalPr", result);
        return { outcome: "completed" };
      },
    },
  ];
}

export class GuestPostingPipelineWorkflow {
  private constructor(
    private readonly engine: WorkflowEngine,
    private readonly agents: PipelineAgents,
  ) {}

  static async create(
    baseDirectory: string = process.cwd(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
    providers: GuestPostingPipelineWorkflowProviders = {},
  ): Promise<GuestPostingPipelineWorkflow> {
    const prospectingAgent = await ProspectingAgent.create(
      loadProspectingAgentConfig({}, baseDirectory),
      providers.prospectDiscoveryProvider ?? new NullProspectDiscoveryProvider(),
      approvalChannel,
    );
    const publisherQualificationAgent = await PublisherQualificationAgent.create(
      loadPublisherQualificationAgentConfig({}, baseDirectory),
      providers.publisherQualityProvider ?? new NullPublisherQualityProvider(),
      approvalChannel,
    );
    const contactIntelligenceAgent = await ContactIntelligenceAgent.create(
      loadContactIntelligenceAgentConfig({}, baseDirectory),
      providers.contactDiscoveryProvider ?? new NullContactDiscoveryProvider(),
      approvalChannel,
    );
    const outreachAgent = await OutreachAgent.create(loadOutreachAgentConfig({}, baseDirectory), approvalChannel);
    const campaignTrackingAgent = await CampaignTrackingAgent.create(loadCampaignTrackingAgentConfig({}, baseDirectory));
    const replyNegotiationAgent = await ReplyNegotiationAgent.create(
      loadReplyNegotiationAgentConfig({}, baseDirectory),
      providers.publisherReplyProvider ?? new NullPublisherReplyProvider(),
      approvalChannel,
    );
    const guestPostingDigitalPrAgent = await GuestPostingDigitalPrAgent.create(loadGuestPostingDigitalPrAgentConfig({}, baseDirectory));

    const workflowAuditLogPath =
      process.env["GUEST_POSTING_PIPELINE_WORKFLOW_AUDIT_LOG"] ??
      join(baseDirectory, "var", "workflows", "guest-posting-pipeline-workflow", "audit-log.jsonl");
    const auditLogger = new AuditLogger(workflowAuditLogPath);
    const engine = new WorkflowEngine(auditLogger);

    return new GuestPostingPipelineWorkflow(engine, {
      prospectingAgent,
      publisherQualificationAgent,
      contactIntelligenceAgent,
      outreachAgent,
      campaignTrackingAgent,
      replyNegotiationAgent,
      guestPostingDigitalPrAgent,
    });
  }

  async run(input: GuestPostingPipelineWorkflowInput): Promise<WorkflowRunResult> {
    const steps = buildGuestPostingPipelineWorkflowSteps(input, this.agents);
    return this.engine.run("guest-posting-pipeline-workflow", steps, { input });
  }
}

/** Convenience accessor for callers (e.g. an end-to-end test) that want the final, real GuestPostingDigitalPrResult rather than the full step-by-step WorkflowRunResult. */
export function finalGuestPostingResult(runResult: WorkflowRunResult): GuestPostingDigitalPrResult | null {
  return (runResult.outputs["guestPostingDigitalPr"] as GuestPostingDigitalPrResult | undefined) ?? null;
}
