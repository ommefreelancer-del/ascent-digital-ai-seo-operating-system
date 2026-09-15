import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { downloadAndStoreAsset, PixabayApiError } from "@/server/pixabay";
import { pixabayDownloadSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

/**
 * The only route that actually fetches a Pixabay asset's bytes. Must be
 * called for exactly one explicitly-selected asset at a time -- never in a
 * loop over search results -- both because Pixabay's terms prohibit
 * systematic mass downloads and because asset selection must stay under
 * the control of the agent/workflow that requested it, not happen
 * automatically. Stores the file under /public/uploads/pixabay and returns
 * a local URL so the asset is never permanently hotlinked from Pixabay.
 */
export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = pixabayDownloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const stored = await downloadAndStoreAsset(parsed.data.id, parsed.data.url, parsed.data.type);
    await logActivity(session.user.id, "assets", `Downloaded Pixabay ${parsed.data.type} #${parsed.data.id} for local use`);
    return NextResponse.json(stored);
  } catch (err) {
    if (err instanceof PixabayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not download this Pixabay asset." }, { status: 502 });
  }
}
