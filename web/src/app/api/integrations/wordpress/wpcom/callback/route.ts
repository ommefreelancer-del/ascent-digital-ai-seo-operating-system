import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { exchangeWordPressComCodeAndSaveConnection } from "@/server/wordpress";
import { logActivity } from "@/server/log-activity";

function redirectToSettings(request: Request, status: string, message?: string) {
  const target = new URL("/settings", request.url);
  target.searchParams.set("tab", "integrations");
  target.searchParams.set("wordpress", status);
  if (message) target.searchParams.set("wordpress_error", message);
  const response = NextResponse.redirect(target);
  response.cookies.delete("wordpress_com_oauth_state");
  return response;
}

/** Receives the real redirect back from WordPress.com's OAuth2 consent screen, exchanges the code for a token, and auto-discovers the user's real sites. */
export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("wordpress_com_oauth_state")?.value;

  if (oauthError) return redirectToSettings(request, "denied");
  if (!code || !state || !cookieState || state !== cookieState) return redirectToSettings(request, "invalid_state");

  try {
    const redirectUri = new URL("/api/integrations/wordpress/wpcom/callback", process.env.NEXTAUTH_URL).toString();
    const result = await exchangeWordPressComCodeAndSaveConnection(session.user.id, code, redirectUri);
    if (result.siteSelected) {
      await logActivity(session.user.id, "integrations", "Connected WordPress.com");
      return redirectToSettings(request, "connected");
    }
    if (result.sites.length === 0) {
      await logActivity(session.user.id, "integrations", "Connected WordPress.com (no sites found on this account)");
      return redirectToSettings(request, "connected_no_sites");
    }
    await logActivity(session.user.id, "integrations", "Connected WordPress.com -- multiple sites found, awaiting selection");
    return redirectToSettings(request, "select_site");
  } catch (err) {
    return redirectToSettings(request, "error", err instanceof Error ? err.message : "Could not complete the WordPress.com connection.");
  }
}
