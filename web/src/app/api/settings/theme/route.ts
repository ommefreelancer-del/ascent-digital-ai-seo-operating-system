import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";

const themeSchema = z.object({ theme: z.enum(["system", "light", "dark"]) });

export async function PATCH(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = themeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid theme." }, { status: 400 });
  }

  await db.user.update({ where: { id: session.user.id }, data: { theme: parsed.data.theme } });
  return NextResponse.json({ theme: parsed.data.theme });
}
