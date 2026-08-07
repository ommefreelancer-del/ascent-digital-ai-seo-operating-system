import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { chatMessageSchema } from "@/lib/validators";
import { sendConversationMessage, getSpecialistAgentSpec } from "@/server/backend/conversation";
import { generateSpecialistReply } from "@/server/backend/specialist-ai";
import { runFullAudit, type FullAuditResult } from "@/server/backend/website-audit";
import { runContentGenerationPipeline, CONTENT_PIPELINE_ENTRY_AGENT_ID, type PipelineStepTrace } from "@/server/backend/specialist-orchestrator";
import { shouldRouteBackToWebsiteAuditAgent, matchWebsiteAuditFollowUpTerm } from "@/server/backend/follow-up-routing";
import { logActivity } from "@/server/log-activity";
import { truncate } from "@/lib/utils";

// Matches the real Website Audit Agent spec id (Agents/website-audit-agent.md,
// parsed by AgentRegistry -- see src/agents/website-audit-agent/dispatch.ts's
// WEBSITE_AUDIT_AGENT_ID for the canonical backend constant this mirrors).
const WEBSITE_AUDIT_AGENT_ID = "website-audit-agent";
const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/i;
// Fallback for a URL typed without a protocol ("audit example.com"). Deliberately
// conservative: requires a real-looking multi-label domain with a letters-only
// TLD, so it won't fire on ordinary prose like "e.g." or "v1.2". Common
// non-domain file extensions are excluded so "main.js" or "notes.md" don't get
// misread as a website to crawl.
const BARE_DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,}[a-z]{2,}(?:\/[^\s)>\]"']*)?\b/i;
const NON_DOMAIN_TLDS = new Set(["js", "ts", "tsx", "jsx", "py", "md", "txt", "json", "css", "html", "go", "rb", "php", "yml", "yaml"]);

function extractUrl(text: string): string | null {
  const withProtocol = text.match(URL_PATTERN);
  if (withProtocol) return withProtocol[0].replace(/[.,;:]+$/, "");

  const bare = text.match(BARE_DOMAIN_PATTERN);
  if (!bare) return null;
  const candidate = bare[0].replace(/[.,;:]+$/, "");
  const tld = candidate.split("/")[0]?.split(".").pop()?.toLowerCase();
  if (!tld || NON_DOMAIN_TLDS.has(tld)) return null;
  return `https://${candidate}`;
}

/** Builds a reply straight from real FullAuditResult fields -- no LLM, no fabrication, every number traceable to the pipeline that produced it. */
function summarizeAuditForChat(url: string, result: FullAuditResult): string {
  const { websiteAudit, crawl, lighthouse } = result;
  const lines: string[] = [
    `Ran a live technical SEO audit on ${url} using ADASOS's production audit pipeline (real crawl + Lighthouse -- nothing below is estimated).`,
    "",
    `**Crawl**: ${crawl.pagesCrawled} page(s) crawled. robots.txt: ${crawl.robotsTxtFound ? "found" : "checked, not found (404)"}. sitemap.xml: ${crawl.sitemapUrlsFound} URL(s) discovered (checked).`,
    `**HTTP headers**: real response headers inspected across every crawled page (security-header findings included below if any).`,
    lighthouse.available
      ? `**Lighthouse**: Performance ${lighthouse.categoryScores?.performance ?? "—"}, Accessibility ${lighthouse.categoryScores?.accessibility ?? "—"}, Best Practices ${lighthouse.categoryScores?.bestPractices ?? "—"}, SEO ${lighthouse.categoryScores?.seo ?? "—"}. Core Web Vitals -- LCP ${lighthouse.coreWebVitals?.lcpMs != null ? `${Math.round(lighthouse.coreWebVitals.lcpMs)}ms` : "—"}, CLS ${lighthouse.coreWebVitals?.cls ?? "—"}.`
      : `**Lighthouse**: Not Verifiable (the real Lighthouse run did not return a result for this URL).`,
    `**Findings**: ${websiteAudit.summary.criticalCount} critical, ${websiteAudit.summary.warningCount} warning, ${websiteAudit.summary.infoCount} info.`,
  ];

  const notable = websiteAudit.findings.filter((f) => f.severity !== "info").slice(0, 6);
  if (notable.length > 0) {
    lines.push("", "Top issues:");
    for (const f of notable) {
      lines.push(`- [${f.severity}] (${f.category}) ${f.message}`);
    }
  }

  lines.push("", "Full evidence (every crawled page, all findings, real headers) is saved -- open SEO Audit for the complete report, or ask me about any specific finding.");
  return lines.join("\n");
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = chatMessageSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { message } = parsed.data;
  const userId = session.user.id;

  try {
    // A JWT session can still decode successfully after its underlying user
    // row is gone (e.g. the account was deleted or the dev DB was reset).
    // Without this check, chatSession.create() below fails with an unhandled
    // Prisma foreign-key error, which Next.js turns into a response with no
    // JSON body -- the exact cause of the frontend's "Unexpected end of JSON
    // input" error. Fail fast here with a real, parseable error instead.
    const userExists = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      return NextResponse.json({ error: "Your session refers to an account that no longer exists. Please sign out and sign in again." }, { status: 401 });
    }

    let chatSession = parsed.data.sessionId
      ? await db.chatSession.findFirst({ where: { id: parsed.data.sessionId, userId } })
      : null;
    if (!chatSession) {
      chatSession = await db.chatSession.create({ data: { userId, title: truncate(message, 60) } });
    }

    // Looked up BEFORE creating this turn's user/assistant messages, so this
    // is genuinely the *previous* completed task's real assigned agent --
    // never guessed.
    const previousAssistantMessage = await db.chatMessage.findFirst({
      where: { sessionId: chatSession.id, role: "assistant", agentId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { agentId: true },
    });
    const previousAssignedAgentId = previousAssistantMessage?.agentId ?? null;

    const userMessage = await db.chatMessage.create({ data: { sessionId: chatSession.id, role: "user", content: message } });

    let result;
    try {
      result = await sendConversationMessage(chatSession.id, message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The AI Workspace could not process that message.";
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    let { response, escalations } = result;
    let decision = response.routingDecision;

    // BUG FIX: a follow-up referencing "the previous audit" (findings,
    // evidence, validation, review, audit quality, duplicate findings,
    // contradictions) after Website Audit Agent completed the previous task
    // was being answered by the Boss Agent instead of routed back to
    // Website Audit Agent -- TaskRouter scores only the current message's
    // own vocabulary, with no awareness of which agent handled the prior
    // turn. Override the routing decision here, using the real previous
    // agent id and the real matched term -- never fabricated -- rather than
    // letting the Boss Agent's own (contextless) decision stand.
    if (decision?.assignedAgentId !== WEBSITE_AUDIT_AGENT_ID && shouldRouteBackToWebsiteAuditAgent(previousAssignedAgentId, message)) {
      const matchedTerm = matchWebsiteAuditFollowUpTerm(message) ?? "";
      const overrideDecision = {
        taskId: decision?.taskId ?? randomUUID(),
        status: "assigned" as const,
        assignedAgentId: WEBSITE_AUDIT_AGENT_ID,
        candidates: [{ agentId: WEBSITE_AUDIT_AGENT_ID, agentTitle: "Website Audit Agent", score: 1, matchedTerms: [matchedTerm] }],
        rationale: `Follow-up to the previous Website Audit Agent task (matched term: "${matchedTerm}") -- routed back automatically instead of re-scoring through the Boss Agent.`,
        decidedAt: new Date().toISOString(),
      };
      response = {
        ...response,
        intent: "task_request",
        reply: `This has been routed back to "website-audit-agent" -- it's a follow-up to the previous Website Audit Agent task (matched term: "${matchedTerm}").`,
        routingDecision: overrideDecision,
      };
      decision = overrideDecision;
      // The override fully supersedes whatever the Boss Agent's own
      // (contextless) attempt produced -- any escalation it raised never
      // actually reached the user, so it shouldn't be recorded as if it did.
      escalations = [];
    }

    // The Boss Agent's RoutingDecision above is untouched. Once a task is
    // actually assigned, decide how to produce the specialist's real work
    // product:
    //   - Website Audit Agent + a URL in the message -> run the real
    //     production pipeline (runFullAudit: crawl, robots.txt, sitemap.xml,
    //     headers, Lighthouse, schema, links, accessibility) and reply with
    //     its real, evidence-based output. No LLM involved in producing the
    //     findings -- every number traces directly to the pipeline.
    //   - SEO Content Agent -> run the real automatic multi-agent content
    //     pipeline (specialist-orchestrator.ts): Keyword Research -> SEO
    //     Strategy -> SEO Content -> On-Page SEO (internal linking + meta) ->
    //     Guest Posting (only when requested). Each stage's real output is
    //     fed to the next as already-provided context, so the content agent
    //     never has to ask the user for data another specialist can supply.
    //   - Everything else -> ask Claude to role-play that specialist agent's
    //     real Agents/*.md spec, as before. If no API key is configured or
    //     the call fails, fall back to the routing-only reply rather than
    //     fabricating a response or failing the request.
    let assistantContent = response.reply;
    let auditResult: FullAuditResult | null = null;
    let auditUrl: string | null = null;
    let pipelineTrace: readonly PipelineStepTrace[] | null = null;

    if (decision?.status === "assigned" && decision.assignedAgentId === WEBSITE_AUDIT_AGENT_ID) {
      auditUrl = extractUrl(message);
    }

    if (auditUrl) {
      try {
        auditResult = await runFullAudit(auditUrl, "");
        assistantContent = summarizeAuditForChat(auditUrl, auditResult);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The audit could not be completed.";
        assistantContent = `I tried to run a live audit on ${auditUrl} through ADASOS's production pipeline, but it failed: ${reason}`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId === CONTENT_PIPELINE_ENTRY_AGENT_ID) {
      try {
        const pipelineResult = await runContentGenerationPipeline(message, decision.rationale);
        assistantContent = pipelineResult.finalReply;
        pipelineTrace = pipelineResult.trace;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(The automated content pipeline could not complete: ${reason})`;
      }
    } else if (decision?.status === "assigned" && decision.assignedAgentId) {
      try {
        const spec = await getSpecialistAgentSpec(decision.assignedAgentId);
        if (spec) {
          assistantContent = await generateSpecialistReply(spec, message, decision.rationale);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "an unknown error";
        assistantContent = `${response.reply}\n\n(No AI-generated response could be produced: ${reason})`;
      }
    }

    // A chat-triggered audit is a first-class audit -- record it exactly
    // like one run from the SEO Audit page so it shows up in the same
    // history/dashboard, and so the same real evidence can be reopened.
    let seoAuditId: string | null = null;
    if (auditResult) {
      const { summary } = auditResult.websiteAudit;
      const saved = await db.seoAudit.create({
        data: {
          userId,
          url: auditUrl!,
          resultJson: JSON.stringify(auditResult),
          criticalCount: summary.criticalCount,
          warningCount: summary.warningCount,
          infoCount: summary.infoCount,
        },
      });
      seoAuditId = saved.id;
    }

    const assistantMessage = await db.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        content: assistantContent,
        agentId: decision?.assignedAgentId ?? null,
        status: decision?.status ?? null,
        metaJson: JSON.stringify({ routingDecision: decision, escalations, seoAuditId, pipelineTrace }),
      },
    });

    await db.chatSession.update({ where: { id: chatSession.id }, data: { updatedAt: new Date() } });

    await logActivity(
      userId,
      "workspace",
      auditResult
        ? `Ran a live website audit on ${auditUrl} from the AI Workspace`
        : decision?.status === "assigned"
          ? `Routed a task to ${decision.assignedAgentId}`
          : decision?.status === "escalated"
            ? "A workspace task was escalated for review"
            : "Sent a message in the AI Workspace",
    );

    return NextResponse.json({
      sessionId: chatSession.id,
      sessionTitle: chatSession.title,
      userMessage,
      assistantMessage,
      conversation: response,
      escalations,
    });
  } catch (error) {
    // Defense in depth: whatever goes wrong above, the frontend must always
    // get back parseable JSON instead of an empty/opaque error response.
    console.error("[api/workspace/messages] unhandled error", error);
    const reason = error instanceof Error ? error.message : "The AI Workspace could not process that message.";
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
