import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { prospectUpdateSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prospect = await db.prospect.findFirst({ where: { id, userId: session.user.id } });
  if (!prospect) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ prospect });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db.prospect.findFirst({ where: { id, userId: session.user.id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = prospectUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const prospect = await db.prospect.update({
    where: { id },
    data: {
      ...(parsed.data.qualificationStatus !== undefined ? { qualificationStatus: parsed.data.qualificationStatus } : {}),
      ...(parsed.data.outreachStatus !== undefined ? { outreachStatus: parsed.data.outreachStatus } : {}),
      ...(parsed.data.nextFollowUpAt !== undefined ? { nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(parsed.data.nextFollowUpAt) : null } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      ...(parsed.data.outcome !== undefined ? { outcome: parsed.data.outcome || null } : {}),
    },
  });

  await logActivity(session.user.id, "prospects", `Updated prospect "${prospect.domain}"`);
  return NextResponse.json({ prospect });
}
