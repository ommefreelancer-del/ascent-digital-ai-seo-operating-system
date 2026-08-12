import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { searchImages, PixabayNotConfiguredError, PixabayRateLimitError, PixabayApiError } from "@/server/pixabay";
import { pixabayImageSearchSchema } from "@/lib/validators";

/**
 * Real, read-only Pixabay image search for agents/workflows that need a
 * royalty-free visual asset to review (e.g. the Graphic Design Agent).
 * Never downloads or stores anything -- see POST /api/assets/pixabay/download
 * for the explicit, single-asset action that does that once something here
 * has actually been selected.
 */
export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = pixabayImageSearchSchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid search parameters." }, { status: 400 });
  }

  try {
    const result = await searchImages({
      query: parsed.data.query || undefined,
      language: parsed.data.language || undefined,
      imageType: parsed.data.imageType,
      orientation: parsed.data.orientation,
      category: parsed.data.category || undefined,
      minWidth: parsed.data.minWidth,
      minHeight: parsed.data.minHeight,
      safeSearch: parsed.data.safeSearch,
      order: parsed.data.order,
      page: parsed.data.page,
      perPage: parsed.data.perPage,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PixabayNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof PixabayRateLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: err.retryAfterSeconds ? { "Retry-After": String(err.retryAfterSeconds) } : undefined },
      );
    }
    if (err instanceof PixabayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Pixabay image search failed." }, { status: 502 });
  }
}
