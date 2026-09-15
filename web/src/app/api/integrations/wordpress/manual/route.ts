import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { saveConnectionManually, WordPressAuthError, WordPressPermissionError, WordPressInvalidSiteError, WordPressApiError } from "@/server/wordpress";
import { wordPressManualConnectSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

/**
 * Fallback connection path for sites that don't expose (or block) the
 * wp-admin/authorize-application.php redirect -- the user pastes a username
 * and an Application Password they generated themselves in wp-admin (Users
 * -> Profile -> Application Passwords). Still verified against a real API
 * call before being stored; never trusted blindly.
 */
export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = wordPressManualConnectSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    await saveConnectionManually(session.user.id, parsed.data.siteUrl, parsed.data.username, parsed.data.appPassword);
    await logActivity(session.user.id, "integrations", `Connected WordPress (${parsed.data.siteUrl}) manually`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WordPressInvalidSiteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof WordPressAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof WordPressPermissionError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof WordPressApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not connect to WordPress." }, { status: 502 });
  }
}
