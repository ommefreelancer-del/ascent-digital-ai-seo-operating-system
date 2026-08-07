import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import { fetchHtml } from "./website-audit";
import type { ClientReportingResult } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

let agentsPromise: Promise<{ auditAgent: any; techSeoAgent: any; perfAgent: any; reportingAgent: any }> | null = null;

async function getAgents() {
  if (!agentsPromise) {
    agentsPromise = (async () => {
      const [
        { WebsiteAuditAgent },
        { loadWebsiteAuditAgentConfig },
        { TechnicalSeoAgent },
        { loadTechnicalSeoAgentConfig },
        { PerformanceAnalyticsAgent },
        { loadPerformanceAnalyticsAgentConfig },
        { ClientReportingAgent },
        { loadClientReportingAgentConfig },
        { LighthousePerformanceDataProvider },
      ] = await Promise.all([
        importBackend("agents/website-audit-agent/website-audit-agent.js"),
        importBackend("agents/website-audit-agent/config/website-audit-agent.config.js"),
        importBackend("agents/technical-seo-agent/technical-seo-agent.js"),
        importBackend("agents/technical-seo-agent/config/technical-seo-agent.config.js"),
        importBackend("agents/performance-analytics-agent/performance-analytics-agent.js"),
        importBackend("agents/performance-analytics-agent/config/performance-analytics-agent.config.js"),
        importBackend("agents/client-reporting-agent/client-reporting-agent.js"),
        importBackend("agents/client-reporting-agent/config/client-reporting-agent.config.js"),
        importBackend("agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"),
      ]);

      const auditAgent = await WebsiteAuditAgent.create(
        loadWebsiteAuditAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "website-audit-agent", "audit-log.jsonl") }, backendRoot),
        createWebApprovalChannel(),
      );
      const techSeoAgent = await TechnicalSeoAgent.create(
        loadTechnicalSeoAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "technical-seo-agent", "audit-log.jsonl") }, backendRoot),
        createWebApprovalChannel(),
      );
      // Wires the real, already-approved Lighthouse-backed provider (local
      // headless Chrome, no external API key -- the same tech
      // website-audit.ts already uses successfully) instead of the previous
      // `undefined` -> Null default, which silently produced
      // `dataAvailable: false` (no Core Web Vitals / category scores) for
      // every report through this route. See
      // src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.ts.
      // Rankings and traffic remain null either way -- Lighthouse doesn't
      // measure those; they need a real Search Console/Analytics provider
      // (not yet built -- see the production readiness report).
      const perfAgent = await PerformanceAnalyticsAgent.create(
        loadPerformanceAnalyticsAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "performance-analytics-agent", "audit-log.jsonl") }, backendRoot),
        new LighthousePerformanceDataProvider(),
        createWebApprovalChannel(),
      );
      const reportingAgent = await ClientReportingAgent.create(
        loadClientReportingAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "client-reporting-agent", "audit-log.jsonl") }, backendRoot),
        createWebApprovalChannel(),
      );
      return { auditAgent, techSeoAgent, perfAgent, reportingAgent };
    })();
  }
  return agentsPromise;
}

export interface SeoPerformanceReportInput {
  readonly clientName: string;
  readonly reportingPeriodLabel: string;
  readonly url: string;
  readonly businessKpis?: ReadonlyArray<{ label: string; value: string }>;
}

/**
 * Real, end-to-end report: fetches the site's real HTML, runs the real
 * Website Audit + Technical SEO + Performance Analytics agents (the last
 * backed by a real Lighthouse run -- real Core Web Vitals and category
 * scores; rankings/traffic stay null, since Lighthouse doesn't measure
 * those), then synthesizes the real Client Reporting Agent result -- nothing
 * here is templated by the web layer.
 */
export async function generateSeoPerformanceReport(input: SeoPerformanceReportInput): Promise<ClientReportingResult> {
  const { auditAgent, techSeoAgent, perfAgent, reportingAgent } = await getAgents();

  const html = await fetchHtml(input.url);
  const websiteAudit = await auditAgent.auditWebsite({ id: randomUUID(), html, url: input.url });
  const technicalSeo = await techSeoAgent.generateRecommendations({ id: randomUUID(), websiteAudit, crossFunctionalNotes: [] });
  const performanceAnalytics = await perfAgent.analyzePerformance({
    id: randomUUID(),
    url: input.url,
    keywordResearch: { requestId: randomUUID(), classifiedKeywords: [], topicClusters: [], metricsAvailable: false, limitations: [], rankingDisclaimer: "", decidedAt: new Date().toISOString() },
    websiteAudit,
    technicalSeo,
  });

  return reportingAgent.generateReport({
    id: randomUUID(),
    clientName: input.clientName,
    reportingPeriodLabel: input.reportingPeriodLabel,
    performanceAnalytics,
    websiteAudit,
    technicalSeo,
    ...(input.businessKpis ? { businessKpis: input.businessKpis } : {}),
  });
}
