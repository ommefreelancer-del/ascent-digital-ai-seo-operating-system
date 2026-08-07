import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { projectSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await db.project.findMany({
    where: { ownerId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { audits: true, reports: true, activities: true } } },
  });

  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = projectSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const userId = session.user.id;
  const { name, domain, niche, status } = parsed.data;

  const project = await db.project.create({
    data: { ownerId: userId, name, domain: domain || null, niche: niche || null, status },
  });
  await db.projectActivity.create({ data: { projectId: project.id, type: "created", message: "Project created" } });
  await logActivity(userId, "projects", `Created the project "${name}"`);

  return NextResponse.json({ project });
}
