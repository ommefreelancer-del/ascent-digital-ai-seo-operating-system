import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getDashboardData } from "@/server/dashboard";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = await getDashboardData(session.user.id);
  return NextResponse.json(data);
}
