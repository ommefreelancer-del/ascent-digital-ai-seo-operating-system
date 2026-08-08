import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { buildAuthUrl } from "@/server/google-search-console";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildAuthUrl(state));
  response.cookies.set("gsc_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return response;
}
