import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { projectSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await db.project.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      activities: { orderBy: { createdAt: "desc" }, take: 30 },
      audits: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, url: true, criticalCount: true, warningCount: true, infoCount: true, createdAt: true } },
      reports: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, title: true, type: true, createdAt: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db.project.findFirst({ where: { id, ownerId: session.user.id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = projectSchema.partial().safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const project = await db.project.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.domain !== undefined ? { domain: parsed.data.domain || null } : {}),
      ...(parsed.data.niche !== undefined ? { niche: parsed.data.niche || null } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    },
  });

  if (parsed.data.status && parsed.data.status !== existing.status) {
    await db.projectActivity.create({ data: { projectId: project.id, type: "status-change", message: `Status changed to ${parsed.data.status}` } });
    await logActivity(session.user.id, "projects", `Updated "${project.name}" status to ${parsed.data.status}`);
  }

  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db.project.findFirst({ where: { id, ownerId: session.user.id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.project.delete({ where: { id } });
  await logActivity(session.user.id, "projects", `Deleted the project "${existing.name}"`);

  return NextResponse.json({ ok: true });
}
