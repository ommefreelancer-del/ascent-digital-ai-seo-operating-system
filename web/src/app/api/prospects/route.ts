import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { prospectSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const prospects = await db.prospect.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ prospects });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = prospectSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const prospect = await db.prospect.create({
      data: {
        userId: session.user.id,
        domain: parsed.data.domain,
        companyName: parsed.data.companyName || null,
        contactName: parsed.data.contactName || null,
        email: parsed.data.email || null,
        source: parsed.data.source || "manual",
        notes: parsed.data.notes || null,
      },
    });
    await logActivity(session.user.id, "prospects", `Added prospect "${prospect.domain}"`);
    return NextResponse.json({ prospect }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create this prospect." },
      { status: 400 },
    );
  }
}
