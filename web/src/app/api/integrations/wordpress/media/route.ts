import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { uploadMedia, WordPressNotConfiguredError, WordPressSiteNotSelectedError, WordPressApiError, WordPressAuthError, WordPressPermissionError } from "@/server/wordpress";
import { logActivity } from "@/server/log-activity";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB -- generous for a featured image/graphic, well short of "systematic mass upload" territory

/**
 * Uploads a single, explicitly-provided media file to the connected
 * WordPress site's media library. Must only be called for one
 * explicitly-selected file at a time -- this is not a bulk-upload endpoint.
 */
export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "Attach a file under the \"file\" field." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File too large -- limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.` }, { status: 400 });
  }
  const altTextRaw = form.get("altText");
  const altText = typeof altTextRaw === "string" && altTextRaw.trim() ? altTextRaw.trim() : undefined;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const media = await uploadMedia(session.user.id, {
      filename: file.name || "upload",
      mimeType: file.type || "application/octet-stream",
      data: buffer,
      altText,
    });
    await logActivity(session.user.id, "integrations", `Uploaded "${file.name}" to WordPress media library`);
    return NextResponse.json(media);
  } catch (err) {
    if (err instanceof WordPressNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof WordPressSiteNotSelectedError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof WordPressAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof WordPressPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof WordPressApiError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not upload this file." }, { status: 502 });
  }
}
