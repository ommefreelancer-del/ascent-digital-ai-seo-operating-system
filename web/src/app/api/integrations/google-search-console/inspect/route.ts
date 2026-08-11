import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getOrSelectPrimarySite, inspectUrl } from "@/server/google-search-console";
import { urlInspectionSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = urlInspectionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const siteUrl = parsed.data.siteUrl || (await getOrSelectPrimarySite(session.user.id));
    if (!siteUrl) {
      return NextResponse.json(
        { error: "No verified Google Search Console property is available to inspect against." },
        { status: 409 },
      );
    }

    const result = await inspectUrl(session.user.id, siteUrl, parsed.data.url);
    return NextResponse.json({ siteUrl, inspectionUrl: parsed.data.url, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to inspect URL via Search Console." },
      { status: 502 },
    );
  }
}
