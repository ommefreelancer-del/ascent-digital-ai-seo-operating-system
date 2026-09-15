import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { saveConnectionFromAuthorize } from "@/server/wordpress";
import { logActivity } from "@/server/log-activity";

function redirectToSettings(request: Request, status: string, message?: string) {
  const target = new URL("/settings", request.url);
  target.searchParams.set("tab", "integrations");
  target.searchParams.set("wordpress", status);
  if (message) target.searchParams.set("wordpress_error", message);
  const response = NextResponse.redirect(target);
  response.cookies.delete("wordpress_oauth_state");
  return response;
}

/** Receives the real redirect back from wp-admin/authorize-application.php: `site_url`, `user_login`, `password` on approval (WordPress's own documented parameters), or `?wp_rejected=1` (our own reject_url) if the user declined. */
export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("wordpress_oauth_state")?.value;

  if (!state || !cookieState || state !== cookieState) {
    return redirectToSettings(request, "invalid_state");
  }
  if (url.searchParams.get("wp_rejected") === "1") {
    return redirectToSettings(request, "denied");
  }

  const siteUrl = url.searchParams.get("site_url");
  const userLogin = url.searchParams.get("user_login");
  const password = url.searchParams.get("password");
  if (!siteUrl || !userLogin || !password) {
    return redirectToSettings(request, "error", "WordPress did not return the expected credentials.");
  }

  try {
    await saveConnectionFromAuthorize(session.user.id, siteUrl, userLogin, password);
    await logActivity(session.user.id, "integrations", `Connected WordPress (${siteUrl})`);
    return redirectToSettings(request, "connected");
  } catch (err) {
    return redirectToSettings(request, "error", err instanceof Error ? err.message : "Could not complete the WordPress connection.");
  }
}
