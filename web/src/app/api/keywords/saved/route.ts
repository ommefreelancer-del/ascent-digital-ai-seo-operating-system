import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { logActivity } from "@/server/log-activity";

const saveKeywordSchema = z.object({
  keyword: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  intentRationale: z.string().trim().min(1),
});

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const saved = await db.savedKeyword.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ saved });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = saveKeywordSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const userId = session.user.id;

  const saved = await db.savedKeyword.upsert({
    where: { userId_keyword: { userId, keyword: parsed.data.keyword } },
    update: { intent: parsed.data.intent, intentRationale: parsed.data.intentRationale },
    create: { userId, ...parsed.data },
  });

  await logActivity(userId, "keywords", `Saved the keyword "${parsed.data.keyword}"`);

  return NextResponse.json({ saved });
}
