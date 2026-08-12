import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import {
  getContent,
  updateContent,
  deleteContent,
  WordPressNotConfiguredError,
  WordPressSiteNotSelectedError,
  WordPressApiError,
  WordPressAuthError,
  WordPressPermissionError,
  WordPressInvalidSiteError,
} from "@/server/wordpress";
import { wordPressContentUpdateSchema } from "@/lib/validators";
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

/** Real GET for a single post/page -- returns its real status and permalink, not just content. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const type = new URL(request.url).searchParams.get("type") === "page" ? "page" : "post";

  try {
    const item = await getContent(session.user.id, Number(id), type);
    return NextResponse.json({ item });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Updates content fields. Editing a draft needs no special confirmation --
 * nothing is live yet. But if this item is currently published, that makes
 * this an update to real, live content, which per the required workflow
 * must only happen when explicitly authorized -- so this route re-checks
 * the item's real current status first and requires `confirm: true` in that
 * case, exactly like the separate publish route requires it to go live at
 * all.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const json = await request.json().catch(() => null);
  const parsed = wordPressContentUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const current = await getContent(session.user.id, Number(id), parsed.data.type);
    if (current.status === "publish" && parsed.data.confirm !== true) {
      return NextResponse.json(
        { error: "This content is already published on the live site. Explicit confirmation is required to update it (confirm: true)." },
        { status: 400 },
      );
    }

    const updated = await updateContent(
      session.user.id,
      Number(id),
      {
        title: parsed.data.title,
        content: parsed.data.content,
        excerpt: parsed.data.excerpt || undefined,
        featuredMediaId: parsed.data.featuredMediaId,
      },
      parsed.data.type,
    );
    await logActivity(
      session.user.id,
      "integrations",
      current.status === "publish" ? `Updated live WordPress content "${updated.title}" (explicitly approved)` : `Updated a WordPress draft "${updated.title}"`,
    );
    return NextResponse.json({ item: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Real DELETE -- ?force=true permanently deletes instead of trashing, intended for cleaning up temporary/test content. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "page" ? "page" : "post";
  const force = url.searchParams.get("force") === "true";

  try {
    await deleteContent(session.user.id, Number(id), type, force);
    await logActivity(session.user.id, "integrations", `Deleted WordPress content #${id}${force ? " (permanently)" : ""}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
