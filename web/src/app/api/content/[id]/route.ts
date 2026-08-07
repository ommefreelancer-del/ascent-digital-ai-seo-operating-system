import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const draft = await db.contentDraft.findFirst({ where: { id, userId: session.user.id } });
  if (!draft) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    draftId: draft.id,
    type: draft.type,
    title: draft.title,
    createdAt: draft.createdAt,
    result: JSON.parse(draft.resultJson),
  });
}
