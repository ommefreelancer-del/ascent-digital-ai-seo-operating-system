import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { selectWordPressComSite, WordPressNotConfiguredError, WordPressInvalidSiteError, WordPressApiError, WordPressAuthError } from "@/server/wordpress";
import { wordPressSelectSiteSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

/** Selects which of the connected WordPress.com account's real sites to use -- re-verified against a fresh /me/sites call, never trusted blindly from client input. */
export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const json = await request.json().catch(() => null);
  const parsed = wordPressSelectSiteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a site." }, { status: 400 });
  }

  try {
    const site = await selectWordPressComSite(session.user.id, parsed.data.siteId);
    await logActivity(session.user.id, "integrations", `Selected WordPress.com site "${site.name}"`);
    return NextResponse.json({ site });
  } catch (err) {
    if (err instanceof WordPressNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof WordPressInvalidSiteError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof WordPressAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof WordPressApiError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not select this site." }, { status: 502 });
  }
}
