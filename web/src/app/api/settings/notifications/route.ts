import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";

const notificationsSchema = z.object({
  emailNotifications: z.boolean(),
  productUpdates: z.boolean(),
  weeklyDigest: z.boolean(),
});

export async function PATCH(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = notificationsSchema.partial().safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const user = await db.user.update({ where: { id: session.user.id }, data: parsed.data });

  return NextResponse.json({
    emailNotifications: user.emailNotifications,
    productUpdates: user.productUpdates,
    weeklyDigest: user.weeklyDigest,
  });
}
