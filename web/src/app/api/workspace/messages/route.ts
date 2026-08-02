import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { chatMessageSchema } from "@/lib/validators";
import { sendConversationMessage, getSpecialistAgentSpec } from "@/server/backend/conversation";
import { generateSpecialistReply } from "@/server/backend/specialist-ai";
import { runFullAudit, type FullAuditResult } from "@/server/backend/website-audit";
import { logActivity } from "@/server/log-activity";
import { truncate } from "@/lib/utils";

// Matches the real Website Audit Agent spec id (Agents/website-audit-agent.md,
// parsed by AgentRegistry -- see src/agents/website-audit-agent/dispatch.ts's
// WEBSITE_AUDIT_AGENT_ID for the canonical backend constant this mirrors).
const WEBSITE_AUDIT_AGENT_ID = "website-audit-agent";
const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/i;

function extractUrl(text: string): string | null {
  const match = text.match(URL_PATTERN);
  return match ? match[0].replace(/[.,;:]+$/, "") : null;
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

    const userMessage = await db.chatMessage.create({ data: { sessionId: chatSession.id, role: "user", content: message } });

    let result;
    try {
      result = await sendConversationMessage(chatSession.id, message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The AI Workspace could not process that message.";
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    const { response, escalations } = result;
    const decision = response.routingDecision;

    // The Boss Agent's RoutingDecision above is untouched. Once a task is
    // actually assigned, decide how to produce the specialist's real work
    // product:
    //   - Website Audit Agent + a URL in the message -> run the real
    //     production pipeline (runFullAudit: crawl, robots.txt, sitemap.xml,
    //     headers, Lighthouse, schema, links, accessibility) and reply with
    //     its real, evidence-based output. No LLM involved in producing the
    //     findings -- every number traces directly to the pipeline.
    //   - Everything else -> ask Claude to role-play that specialist agent's
    //     real Agents/*.md spec, as before. If no API key is configured or
    //     the call fails, fall back to the routing-only reply rather than
    //     fabricating a response or failing the request.
    let assistantContent = response.reply;
    let auditResult: FullAuditResult | null = null;
    let auditUrl: string | null = null;

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
        metaJson: JSON.stringify({ routingDecision: decision, escalations, seoAuditId }),
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
