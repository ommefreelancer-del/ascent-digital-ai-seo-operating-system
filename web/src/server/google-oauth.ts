// Shared, service-agnostic Google OAuth 2.0 core (token exchange, refresh,
// revoke). Extracted so Google services beyond Search Console -- Business
// Profile now, Sheets/Gmail later -- don't each reimplement this logic.
//
// server/google-search-console.ts predates this module and already has its
// own independent, production-verified implementation of the same calls; it
// is deliberately left untouched rather than refactored onto this shared
// core, to avoid any risk to that already-working integration for a
// refactor with no functional benefit to it.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export function buildGoogleAuthUrl(params: { scope: string; redirectUri: string; state: string }): string {
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: params.scope,
    access_type: "offline",
    prompt: "consent", // forces a refresh_token on every connect, not just the first
    state: params.state,
  });
  return `${AUTH_URL}?${query.toString()}`;
}

export async function exchangeGoogleCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Best-effort revoke -- Google's own token expiry/rotation makes a failure here non-fatal either way. */
export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}
