// CLI runner for the full 23-step SEO audit workflow against a real, live
// URL. Usage: node scripts/run-seo-audit.mjs <url> [seedKeyword1,seedKeyword2,...]
// Requires `npm run build` first (imports from dist/src/).
//
// Prints a human-readable summary to stdout and writes the full,
// unmodified WorkflowRunResult JSON to var/workflows/seo-audit-workflow/
// last-run.json for inspection. Every number/finding printed here comes
// directly from the workflow's real output -- this script does not compute
// or embellish anything itself.

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SeoAuditWorkflow } from "../dist/src/workflows/seo-audit-workflow.js";
import { LighthousePerformanceDataProvider } from "../dist/src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js";

const startUrl = process.argv[2];
if (!startUrl) {
  console.error("Usage: node scripts/run-seo-audit.mjs <url> [comma,separated,keywords]");
  process.exit(1);
}
const seedKeywords = (process.argv[3] ?? "").split(",").map((k) => k.trim()).filter(Boolean);

const escalations = [];

const recordingAutoApprovalChannel = {
  async requestDecision(request) {
    const candidate = request.candidates[0];
    escalations.push({ summary: request.summary, autoResolvedTo: candidate?.label ?? "no candidate available" });
    return {
      requestId: request.id,
      outcome: candidate ? "candidate_selected" : "rejected",
      ...(candidate ? { selectedCandidateId: candidate.id } : {}),
      notes: "Auto-resolved by scripts/run-seo-audit.mjs (non-interactive run) -- see escalations in the output for what was decided and why.",
      decidedAt: new Date().toISOString(),
    };
  },
};

async function main() {
  console.log(`Running the 23-step SEO audit workflow against: ${startUrl}`);
  if (seedKeywords.length > 0) console.log(`Seed keywords: ${seedKeywords.join(", ")}`);

  const workflow = await SeoAuditWorkflow.create(process.cwd(), recordingAutoApprovalChannel, {
    performanceDataProvider: new LighthousePerformanceDataProvider(),
  });

  const result = await workflow.run({
    startUrl,
    businessObjective: "Understand this site's real, current SEO health across every crawlable page.",
    seedKeywords,
    crawlOptions: { maxPages: 30 },
    includePerformanceAudit: true,
  });

  const outDir = join(process.cwd(), "var", "workflows", "seo-audit-workflow");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "last-run.json");
  await writeFile(outPath, JSON.stringify({ result, escalations }, null, 2), "utf8");

  console.log(`\nRun ID: ${result.runId}`);
  console.log(`Halted: ${result.halted}${result.haltReason ? ` (${result.haltReason})` : ""}`);
  console.log("\nStep results:");
  for (const step of result.stepResults) {
    console.log(`  [${step.status.padEnd(9)}] ${step.name}${step.detail ? ` -- ${step.detail}` : ""}`);
  }

  if (escalations.length > 0) {
    console.log(`\n${escalations.length} escalation(s) were auto-resolved by this non-interactive run:`);
    for (const e of escalations) {
      console.log(`  - ${e.summary}\n    -> ${e.autoResolvedTo}`);
    }
  }

  console.log(`\nFull result written to: ${outPath}`);
}

main().catch((error) => {
  console.error("Workflow run failed:", error);
  process.exit(1);
});
