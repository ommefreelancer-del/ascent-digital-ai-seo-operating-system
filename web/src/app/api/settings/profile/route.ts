import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { profileSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

export async function PATCH(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = profileSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const user = await db.user.update({
    where: { id: session.user.id },
    data: {
      name: parsed.data.name,
      companyName: parsed.data.companyName || null,
      jobTitle: parsed.data.jobTitle || null,
    },
  });

  await logActivity(session.user.id, "settings", "Updated profile details");

  return NextResponse.json({ user: { id: user.id, name: user.name, companyName: user.companyName, jobTitle: user.jobTitle } });
}
