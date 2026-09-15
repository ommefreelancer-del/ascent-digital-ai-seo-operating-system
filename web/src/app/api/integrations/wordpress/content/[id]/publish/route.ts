import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { publishPost, WordPressNotConfiguredError, WordPressSiteNotSelectedError, WordPressApiError, WordPressAuthError, WordPressPermissionError, WordPressInvalidSiteError } from "@/server/wordpress";
import { wordPressPublishSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

/**
 * The only route in ADASOS that can make a WordPress post/page go live.
 * Requires an explicit `{ confirm: true }` body -- mirrors
 * POST /api/prospects/[id]/send's send-gate for Gmail. Nothing upstream
 * (agent research, drafting, editing) can reach WordPress's publish
 * endpoint except through this one route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const json = await request.json().catch(() => null);
  const parsed = wordPressPublishSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Explicit confirmation is required to publish (confirm: true)." }, { status: 400 });
  }

  try {
    const published = await publishPost(session.user.id, Number(id), parsed.data.type);
    await logActivity(session.user.id, "integrations", `Published WordPress content "${published.title}" (explicitly approved)`);
    return NextResponse.json({ item: published });
  } catch (err) {
    if (err instanceof WordPressNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof WordPressSiteNotSelectedError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof WordPressInvalidSiteError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof WordPressAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof WordPressPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof WordPressApiError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not publish this content." }, { status: 502 });
  }
}
