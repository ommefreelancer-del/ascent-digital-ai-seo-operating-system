import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import type { KeywordResearchResult } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

let agentPromise: Promise<any> | null = null;

async function getAgent() {
  if (!agentPromise) {
    agentPromise = (async () => {
      const [{ KeywordResearchAgent }, { loadKeywordResearchAgentConfig }] = await Promise.all([
        importBackend("agents/keyword-research-agent/keyword-research-agent.js"),
        importBackend("agents/keyword-research-agent/config/keyword-research-agent.config.js"),
      ]);
      const backendRoot = path.resolve(here, "../../../..");
      const config = loadKeywordResearchAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "keyword-research-agent", "audit-log.jsonl") }, backendRoot);
      // A non-interactive channel is required here: the default
      // CliApprovalChannel reads process.stdin, which would hang a web
      // request forever if this agent's own policy-risk signal ever fires.
      return KeywordResearchAgent.create(config, undefined, createWebApprovalChannel());
    })();
  }
  return agentPromise;
}

export async function researchKeywords(businessObjective: string, seedKeywords: readonly string[], targetAudience?: string): Promise<KeywordResearchResult> {
  const agent = await getAgent();
  return agent.researchKeywords({
    id: randomUUID(),
    businessObjective,
    seedKeywords,
    ...(targetAudience ? { targetAudience } : {}),
  });
}
