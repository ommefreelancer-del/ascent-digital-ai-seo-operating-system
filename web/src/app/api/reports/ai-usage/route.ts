import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { aiUsageReportSchema } from "@/lib/validators";
import { buildAiUsageReport } from "@/server/reports";
import { logActivity } from "@/server/log-activity";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = aiUsageReportSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { periodDays } = parsed.data;
  const userId = session.user.id;

  const result = await buildAiUsageReport(userId, periodDays);

  const report = await db.report.create({
    data: { userId, title: `AI Usage — ${result.periodLabel}`, type: "ai-usage", resultJson: JSON.stringify(result) },
  });

  await logActivity(userId, "reports", "Generated an AI usage report");

  return NextResponse.json({ reportId: report.id, result });
}
