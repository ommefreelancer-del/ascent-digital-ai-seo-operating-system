import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { seoPerformanceReportSchema } from "@/lib/validators";
import { generateSeoPerformanceReport } from "@/server/backend/reporting";
import { logActivity } from "@/server/log-activity";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = seoPerformanceReportSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { clientName, reportingPeriodLabel, url, projectId } = parsed.data;
  const userId = session.user.id;

  if (projectId) {
    const project = await db.project.findFirst({ where: { id: projectId, ownerId: userId } });
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
  }

  let result;
  try {
    result = await generateSeoPerformanceReport({ clientName, reportingPeriodLabel, url });
  } catch (error) {
    console.error("[api/reports/seo-performance] generation failed", error);
    return NextResponse.json({ error: "The report could not be generated. Please try again." }, { status: 502 });
  }

  const report = await db.report.create({
    data: {
      userId,
      projectId: projectId || null,
      title: `${clientName} — ${reportingPeriodLabel}`,
      type: "seo-performance",
      resultJson: JSON.stringify(result),
    },
  });

  if (projectId) {
    await db.projectActivity.create({ data: { projectId, type: "report", message: `SEO performance report generated for ${reportingPeriodLabel}` } });
  }
  await logActivity(userId, "reports", `Generated an SEO performance report for ${clientName}`);

  return NextResponse.json({ reportId: report.id, result });
}
