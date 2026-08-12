import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { buildWordPressComConnectUrl } from "@/server/wordpress";

/**
 * Sends the user straight to WordPress.com's real OAuth2 consent screen --
 * no site URL needed up front. After they approve, the callback discovers
 * their real sites automatically (see wpcom/callback/route.ts).
 */
export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.WPCOM_CLIENT_ID) {
    const target = new URL("/settings", request.url);
    target.searchParams.set("tab", "integrations");
    target.searchParams.set("wordpress", "error");
    target.searchParams.set("wordpress_error", "WordPress.com sign-in is not configured on this server yet (WPCOM_CLIENT_ID is unset).");
    return NextResponse.redirect(target);
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL("/api/integrations/wordpress/wpcom/callback", process.env.NEXTAUTH_URL).toString();
  const response = NextResponse.redirect(buildWordPressComConnectUrl(redirectUri, state));
  response.cookies.set("wordpress_com_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return response;
}
