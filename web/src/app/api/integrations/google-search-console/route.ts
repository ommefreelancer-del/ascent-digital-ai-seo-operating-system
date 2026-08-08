import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { disconnect, getConnectionStatus } from "@/server/google-search-console";
import { logActivity } from "@/server/log-activity";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await getConnectionStatus(session.user.id);
  return NextResponse.json(status);
}

export async function DELETE() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await disconnect(session.user.id);
  await logActivity(session.user.id, "integrations", "Disconnected Google Search Console");
  return NextResponse.json({ ok: true });
}
