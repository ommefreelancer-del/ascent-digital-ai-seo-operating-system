import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { exchangeCodeForTokens, saveConnection } from "@/server/google-search-console";
import { logActivity } from "@/server/log-activity";

function redirectToSettings(request: Request, status: string) {
  const target = new URL("/settings", request.url);
  target.searchParams.set("tab", "integrations");
  target.searchParams.set("gsc", status);
  const response = NextResponse.redirect(target);
  response.cookies.delete("gsc_oauth_state");
  return response;
}

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
  const cookieState = cookieStore.get("gsc_oauth_state")?.value;

  if (oauthError) return redirectToSettings(request, "denied");
  if (!code || !state || !cookieState || state !== cookieState) return redirectToSettings(request, "invalid_state");

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(session.user.id, tokens);
    await logActivity(session.user.id, "integrations", "Connected Google Search Console");
    return redirectToSettings(request, "connected");
  } catch {
    return redirectToSettings(request, "error");
  }
}
