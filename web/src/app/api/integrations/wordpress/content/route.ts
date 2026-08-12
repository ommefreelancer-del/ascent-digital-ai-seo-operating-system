import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { listContent, createDraft, WordPressNotConfiguredError, WordPressSiteNotSelectedError, WordPressApiError, WordPressAuthError, WordPressPermissionError, WordPressInvalidSiteError } from "@/server/wordpress";
import { wordPressListContentSchema, wordPressDraftCreateSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

function errorResponse(err: unknown) {
  if (err instanceof WordPressNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
  if (err instanceof WordPressSiteNotSelectedError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof WordPressInvalidSiteError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof WordPressAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof WordPressPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof WordPressApiError) return NextResponse.json({ error: err.message }, { status: 502 });
  return NextResponse.json({ error: err instanceof Error ? err.message : "WordPress request failed." }, { status: 502 });
}

/** Real, read-only list of posts/pages (drafts included, since this is an authenticated context=edit request) for the connected site. */
export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = wordPressListContentSchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const items = await listContent(session.user.id, parsed.data.type, {
      status: parsed.data.status,
      search: parsed.data.search,
      page: parsed.data.page,
      perPage: parsed.data.perPage,
    });
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Creates a new draft only -- never publishes. This is the "agent prepares"
 * half of the required research -> create -> review -> approve -> publish
 * workflow; the explicit publish step lives at
 * POST /api/integrations/wordpress/content/[id]/publish.
 */
export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = wordPressDraftCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const draft = await createDraft(session.user.id, {
      title: parsed.data.title,
      content: parsed.data.content,
      excerpt: parsed.data.excerpt || undefined,
      type: parsed.data.type,
    });
    await logActivity(session.user.id, "integrations", `Created a WordPress draft "${parsed.data.title}"`);
    return NextResponse.json({ item: draft });
  } catch (err) {
    return errorResponse(err);
  }
}
