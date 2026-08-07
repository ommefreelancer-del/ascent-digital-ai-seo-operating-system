import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const audit = await db.seoAudit.findFirst({ where: { id, userId: session.user.id } });
  if (!audit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    auditId: audit.id,
    url: audit.url,
    createdAt: audit.createdAt,
    result: JSON.parse(audit.resultJson),
  });
}
