import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { contentGeneratorSchema } from "@/lib/validators";
import { generateContent } from "@/server/backend/content";
import { logActivity } from "@/server/log-activity";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const drafts = await db.contentDraft.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, type: true, title: true, createdAt: true },
  });

  return NextResponse.json({ drafts });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = contentGeneratorSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { type, topic, businessObjective, brandGuidelines } = parsed.data;
  const userId = session.user.id;

  let result;
  try {
    result = await generateContent({ type, topic, businessObjective, brandGuidelines: brandGuidelines || undefined });
  } catch (error) {
    console.error("[api/content] generation failed", error);
    return NextResponse.json({ error: "Content generation could not be completed. Please try again." }, { status: 502 });
  }

  const title = result.contentDrafts[0]?.title ?? topic;
  const draft = await db.contentDraft.create({
    data: { userId, type, title, resultJson: JSON.stringify(result) },
  });

  await logActivity(userId, "content", `Generated ${type.replace(/-/g, " ")} content for "${topic}"`);

  return NextResponse.json({ draftId: draft.id, result });
}
