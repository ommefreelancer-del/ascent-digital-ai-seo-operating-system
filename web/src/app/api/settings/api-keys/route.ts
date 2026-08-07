import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { apiKeySchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await db.apiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, keyPrefix: true, createdAt: true, lastUsedAt: true },
  });

  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = apiKeySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const secret = randomBytes(24).toString("base64url");
  const rawKey = `adasos_live_${secret}`;
  const keyPrefix = rawKey.slice(0, 18);
  const keyHash = await bcrypt.hash(rawKey, 10);

  const key = await db.apiKey.create({
    data: { userId: session.user.id, label: parsed.data.label, keyPrefix, keyHash },
  });

  await logActivity(session.user.id, "settings", `Created a new API key ("${parsed.data.label}")`);

  return NextResponse.json({
    key: { id: key.id, label: key.label, keyPrefix: key.keyPrefix, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt },
    rawKey,
  });
}
