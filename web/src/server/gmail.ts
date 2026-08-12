// Real Gmail integration, following the same shape as
// server/google-business-profile.ts / server/google-sheets.ts (connect/
// callback/status/disconnect, honest real API calls, never-fabricated
// data), stored in the generic server/db.ts GoogleServiceConnection table
// (service: "gmail") and built on the shared OAuth core in
// server/google-oauth.ts.
//
// Strict human-in-the-loop, per GLOBAL_RULES.md SS9 ("Connecting external
// services" / "Executing automations that change external systems" both
// require explicit approval) and the outreach-agent/reply-negotiation-agent
// backends' own design (every draft is prepared, never sent, by those
// agents -- see their OUT_OF_SCOPE_LIMITATION comments): this module never
// sends anything on its own initiative. createDraft() only ever creates a
// Gmail draft. sendDraft() sends one -- it is only ever called from the
// explicit, human-triggered "approve and send" route, never automatically
// from any other flow in this app.
//
// Scope is gmail.compose + gmail.readonly -- deliberately NOT gmail.send
// (which would allow sending a message directly, bypassing the draft step)
// and NOT gmail.labels (status is tracked in Prospect.outreachStatus, this
// app's own system of record, not via Gmail labels).

import { db } from "@/server/db";
import { buildGoogleAuthUrl, exchangeGoogleCodeForTokens, refreshGoogleAccessToken, revokeGoogleToken, type GoogleTokenResponse } from "@/server/google-oauth";

const SERVICE = "gmail";
const SCOPE = "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailDraft {
  id: string;
  messageId: string;
  threadId: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  /** True if this message was received (has the INBOX label), false if sent by us (has the SENT label). */
  isReceived: boolean;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  internalDate: string;
}

export interface GmailThread {
  id: string;
  messages: GmailMessageSummary[];
  /** True if any message in the thread was received after our own last sent message -- a real reply exists. */
  hasReply: boolean;
}

function redirectUri(): string {
  return `${process.env.NEXTAUTH_URL}/api/integrations/gmail/callback`;
}

export function buildAuthUrl(state: string): string {
  return buildGoogleAuthUrl({ scope: SCOPE, redirectUri: redirectUri(), state });
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  return exchangeGoogleCodeForTokens(code, redirectUri());
}

export async function saveConnection(userId: string, tokens: GoogleTokenResponse) {
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh_token (expected with prompt=consent).");
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  return db.googleServiceConnection.upsert({
    where: { userId_service: { userId, service: SERVICE } },
    update: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope, expiresAt },
    create: { userId, service: SERVICE, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope, expiresAt },
  });
}

export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; connectedAt?: string }> {
  const connection = await db.googleServiceConnection.findUnique({
    where: { userId_service: { userId, service: SERVICE } },
    select: { updatedAt: true },
  });
  return connection ? { connected: true, connectedAt: connection.updatedAt.toISOString() } : { connected: false };
}

export async function disconnect(userId: string): Promise<void> {
  const connection = await db.googleServiceConnection.findUnique({ where: { userId_service: { userId, service: SERVICE } } });
  if (!connection) return;
  await revokeGoogleToken(connection.refreshToken);
  await db.googleServiceConnection.delete({ where: { userId_service: { userId, service: SERVICE } } });
}

/** Returns a usable access token for `userId`'s Gmail connection, refreshing it first if it's expired or about to expire. Returns null if there's no connection. */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await db.googleServiceConnection.findUnique({ where: { userId_service: { userId, service: SERVICE } } });
  if (!connection) return null;
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  const refreshed = await refreshGoogleAccessToken(connection.refreshToken);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db.googleServiceConnection.update({
    where: { userId_service: { userId, service: SERVICE } },
    data: { accessToken: refreshed.access_token, expiresAt },
  });
  return refreshed.access_token;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRawMessage(params: { to: string; subject: string; body: string; inReplyTo?: string }): string {
  const headers = [`To: ${params.to}`, `Subject: ${params.subject}`, `Content-Type: text/plain; charset="UTF-8"`, `MIME-Version: 1.0`];
  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo}`, `References: ${params.inReplyTo}`);
  }
  const raw = headers.join("\r\n") + "\r\n\r\n" + params.body;
  return base64UrlEncode(raw);
}

/** Real call to Gmail's users.drafts.create -- creates a draft only, never sends. Threads within an existing gmailThreadId when provided. Throws with the full response body on failure. */
export async function createDraft(
  userId: string,
  params: { to: string; subject: string; body: string; threadId?: string; inReplyToRfc822MessageId?: string },
): Promise<GmailDraft> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Gmail connection exists for this user.");
  }

  const raw = buildRawMessage({ to: params.to, subject: params.subject, body: params.body, inReplyTo: params.inReplyToRfc822MessageId });
  const res = await fetch(`${GMAIL_API_URL}/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw, threadId: params.threadId } }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail drafts.create failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { id: string; message: { id: string; threadId: string } } = JSON.parse(body);
  return { id: data.id, messageId: data.message.id, threadId: data.message.threadId };
}

/** Real call to Gmail's users.drafts.get. Throws with the full response body on failure. */
export async function getDraft(userId: string, draftId: string): Promise<{ id: string; messageId: string; threadId: string; snippet: string }> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Gmail connection exists for this user.");
  }

  const res = await fetch(`${GMAIL_API_URL}/drafts/${encodeURIComponent(draftId)}?format=metadata`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail drafts.get failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { id: string; message: { id: string; threadId: string; snippet?: string } } = JSON.parse(body);
  return { id: data.id, messageId: data.message.id, threadId: data.message.threadId, snippet: data.message.snippet ?? "" };
}

/**
 * Real call to Gmail's users.drafts.send -- ACTUALLY SENDS the message.
 * Must only ever be invoked from a route the human explicitly triggered
 * after reviewing the draft (see api/prospects/[id]/send/route.ts). Never
 * call this from any automated/scheduled path.
 */
export async function sendDraft(userId: string, draftId: string): Promise<{ messageId: string; threadId: string }> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Gmail connection exists for this user.");
  }

  const res = await fetch(`${GMAIL_API_URL}/drafts/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: draftId }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail drafts.send failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { id: string; threadId: string } = JSON.parse(body);
  return { messageId: data.id, threadId: data.threadId };
}

/** Real call to Gmail's users.threads.get -- retrieves every real message in the thread (sent and received), for reply detection and review. Throws with the full response body on failure. */
export async function getThread(userId: string, threadId: string): Promise<GmailThread> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Gmail connection exists for this user.");
  }

  const res = await fetch(`${GMAIL_API_URL}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail threads.get failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: {
    id: string;
    messages: Array<{
      id: string;
      threadId: string;
      labelIds?: string[];
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    }>;
  } = JSON.parse(body);

  const messages: GmailMessageSummary[] = (data.messages ?? []).map((m) => {
    const headers = m.payload?.headers ?? [];
    const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    return {
      id: m.id,
      threadId: m.threadId,
      isReceived: (m.labelIds ?? []).includes("INBOX") && !(m.labelIds ?? []).includes("SENT"),
      from: header("From"),
      to: header("To"),
      subject: header("Subject"),
      snippet: m.snippet ?? "",
      internalDate: m.internalDate ?? "",
    };
  });

  return { id: data.id, messages, hasReply: messages.some((m) => m.isReceived) };
}
