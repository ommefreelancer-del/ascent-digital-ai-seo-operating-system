import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { buildKeywordGrowthReport } from "@/server/reports";
import { logActivity } from "@/server/log-activity";

export async function POST() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const result = await buildKeywordGrowthReport(userId);

  const report = await db.report.create({
    data: { userId, title: `Keyword Growth — ${new Date().toLocaleDateString()}`, type: "keyword-growth", resultJson: JSON.stringify(result) },
  });

  await logActivity(userId, "reports", "Generated a keyword growth report");

  return NextResponse.json({ reportId: report.id, result });
}
