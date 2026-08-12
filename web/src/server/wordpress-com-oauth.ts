// WordPress.com OAuth2 core (https://developer.wordpress.com/docs/oauth2/),
// mirroring server/google-oauth.ts's shape: this module owns only the
// authorization URL and code-for-token exchange, so a WordPress.com service
// module doesn't reimplement it. Requires a one-time WordPress.com
// "Application" registration (developer.wordpress.com/apps/) for
// WPCOM_CLIENT_ID/WPCOM_CLIENT_SECRET -- exactly analogous to
// GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET already used elsewhere in this
// codebase. That registration is a WordPress.com-account-level action (no
// site, domain, or Jetpack required) that this module cannot perform itself
// -- there is no REST API for registering OAuth applications.
//
// Unlike Google's OAuth2, WordPress.com's token response includes no
// refresh_token (see the real response shape below) -- there is no
// documented refresh flow, so a token that stops working requires the user
// to reconnect, same as this codebase already does for any other auth
// failure.

const AUTHORIZE_URL = "https://public-api.wordpress.com/oauth2/authorize";
const TOKEN_URL = "https://public-api.wordpress.com/oauth2/token";

export interface WordPressComTokenResponse {
  access_token: string;
  token_type: string;
  blog_id?: string;
  blog_url?: string;
}

export function buildWordPressComAuthUrl(params: { redirectUri: string; state: string }): string {
  const query = new URLSearchParams({
    client_id: process.env.WPCOM_CLIENT_ID!,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: "global",
    state: params.state,
  });
  return `${AUTHORIZE_URL}?${query.toString()}`;
}

export async function exchangeWordPressComCodeForToken(code: string, redirectUri: string): Promise<WordPressComTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.WPCOM_CLIENT_ID!,
      client_secret: process.env.WPCOM_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`WordPress.com token exchange failed: ${res.status} ${body}`);
  }
  return body ? (JSON.parse(body) as WordPressComTokenResponse) : ({} as WordPressComTokenResponse);
}
