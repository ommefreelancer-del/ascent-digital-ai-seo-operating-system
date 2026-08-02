import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { seoAuditSchema } from "@/lib/validators";
import { runFullAudit } from "@/server/backend/website-audit";
import { logActivity } from "@/server/log-activity";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const audits = await db.seoAudit.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, url: true, criticalCount: true, warningCount: true, infoCount: true, createdAt: true, projectId: true },
  });

  return NextResponse.json({ audits });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = seoAuditSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { url, targetKeyword, projectId } = parsed.data;
  const userId = session.user.id;

  if (projectId) {
    const project = await db.project.findFirst({ where: { id: projectId, ownerId: userId } });
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
  }

  let result;
  try {
    // runFullAudit performs the real crawl itself (robots.txt, sitemap.xml,
    // every discovered internal page, Lighthouse) -- see
    // web/src/server/backend/website-audit.ts.
    result = await runFullAudit(url, targetKeyword);
  } catch (error) {
    // These may be ones we throw ourselves (invalid URL, blocked internal
    // address, HTTP failure, timeout, crawl failure) -- safe to show verbatim.
    const reason = error instanceof Error ? error.message : "The audit could not be completed. Please try again.";
    const status = reason.includes("could not be crawled") ? 422 : 502;
    if (status === 502) console.error("[api/seo-audit] audit failed", error);
    return NextResponse.json({ error: reason }, { status });
  }

  const { summary } = result.websiteAudit;
  const audit = await db.seoAudit.create({
    data: {
      userId,
      projectId: projectId || null,
      url,
      resultJson: JSON.stringify(result),
      criticalCount: summary.criticalCount,
      warningCount: summary.warningCount,
      infoCount: summary.infoCount,
    },
  });

  if (projectId) {
    await db.projectActivity.create({
      data: { projectId, type: "seo-audit", message: `SEO audit run for ${url} (${summary.criticalCount} critical, ${summary.warningCount} warnings)` },
    });
  }
  await logActivity(userId, "seo-audit", `Ran an SEO audit on ${url}`);

  return NextResponse.json({ auditId: audit.id, result });
}
