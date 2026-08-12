import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { listWordPressComSites, WordPressNotConfiguredError, WordPressApiError, WordPressAuthError } from "@/server/wordpress";

/** Real, read-only list of the connected WordPress.com account's own sites, for the picker shown when there's more than one (or when switching). */
export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const sites = await listWordPressComSites(session.user.id);
    return NextResponse.json({ sites });
  } catch (err) {
    if (err instanceof WordPressNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof WordPressAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof WordPressApiError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not list WordPress.com sites." }, { status: 502 });
  }
}
