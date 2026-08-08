import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { listSites } from "@/server/google-search-console";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sites = await listSites(session.user.id);
    return NextResponse.json({ sites, count: sites.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list Search Console sites." },
      { status: 502 },
    );
  }
}
