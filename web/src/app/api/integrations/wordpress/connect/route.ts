import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { buildAuthorizeUrl, WordPressInvalidSiteError } from "@/server/wordpress";
import { wordPressConnectSchema } from "@/lib/validators";

function redirectToSettings(request: Request, status: string, message?: string) {
  const target = new URL("/settings", request.url);
  target.searchParams.set("tab", "integrations");
  target.searchParams.set("wordpress", status);
  if (message) target.searchParams.set("wordpress_error", message);
  return NextResponse.redirect(target);
}

/**
 * Sends the user to their own site's real wp-admin/authorize-application.php
 * (WordPress core's own Application Passwords consent screen -- no plugin,
 * no ADASOS-held credential) to approve the connection. Takes ?siteUrl= from
 * the Settings UI's form. Never generates or guesses a credential itself.
 */
export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = wordPressConnectSchema.safeParse({ siteUrl: url.searchParams.get("siteUrl") ?? "" });
  if (!parsed.success) {
    return redirectToSettings(request, "error", parsed.error.issues[0]?.message ?? "Enter your WordPress site URL.");
  }

  const state = randomBytes(24).toString("hex");
  const callbackUrl = new URL("/api/integrations/wordpress/callback", process.env.NEXTAUTH_URL);
  const successUrl = new URL(callbackUrl);
  successUrl.searchParams.set("state", state);
  const rejectUrl = new URL(callbackUrl);
  rejectUrl.searchParams.set("state", state);
  rejectUrl.searchParams.set("wp_rejected", "1");

  try {
    const { authorizeUrl } = await buildAuthorizeUrl(parsed.data.siteUrl, successUrl.toString(), rejectUrl.toString());
    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set("wordpress_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch (err) {
    if (err instanceof WordPressInvalidSiteError) {
      return redirectToSettings(request, "invalid_site", err.message);
    }
    return redirectToSettings(request, "error", err instanceof Error ? err.message : "Could not start the WordPress connection.");
  }
}
