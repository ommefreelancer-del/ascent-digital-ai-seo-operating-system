import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { keywordResearchSchema } from "@/lib/validators";
import { researchKeywords } from "@/server/backend/keyword-research";
import { logActivity } from "@/server/log-activity";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = keywordResearchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { businessObjective, seedKeywords, targetAudience } = parsed.data;

  let result;
  try {
    result = await researchKeywords(businessObjective, seedKeywords, targetAudience || undefined);
  } catch (error) {
    console.error("[api/keywords/research] research failed", error);
    return NextResponse.json({ error: "Keyword research could not be completed. Please try again." }, { status: 502 });
  }

  await logActivity(session.user.id, "keywords", `Researched keywords for "${seedKeywords.join(", ")}"`);

  return NextResponse.json({ result });
}
