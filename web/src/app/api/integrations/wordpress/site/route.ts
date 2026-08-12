import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getSiteInfo, WordPressNotConfiguredError, WordPressSiteNotSelectedError, WordPressApiError, WordPressAuthError, WordPressPermissionError } from "@/server/wordpress";

function errorResponse(err: unknown) {
  if (err instanceof WordPressNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
  if (err instanceof WordPressSiteNotSelectedError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof WordPressAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof WordPressPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof WordPressApiError) return NextResponse.json({ error: err.message }, { status: 502 });
  return NextResponse.json({ error: err instanceof Error ? err.message : "WordPress request failed." }, { status: 502 });
}

/** Real, read-only site info (name/description/url) for the connected WordPress site. */
export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const site = await getSiteInfo(session.user.id);
    return NextResponse.json(site);
  } catch (err) {
    return errorResponse(err);
  }
}
