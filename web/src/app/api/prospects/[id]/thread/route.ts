import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { getThread } from "@/server/gmail";
import { logActivity } from "@/server/log-activity";

/** Retrieves the real Gmail thread for this prospect (draft, sent, and any received replies) -- read-only, never sends. Updates outreachStatus to "replied" if a real reply is found and the prospect wasn't already past that stage. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prospect = await db.prospect.findFirst({ where: { id, userId: session.user.id } });
  if (!prospect) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!prospect.gmailThreadId) {
    return NextResponse.json({ error: "No Gmail thread exists for this prospect yet." }, { status: 409 });
  }

  try {
    const thread = await getThread(session.user.id, prospect.gmailThreadId);

    let updated = prospect;
    if (thread.hasReply && prospect.outreachStatus !== "replied" && prospect.outreachStatus !== "closed") {
      updated = await db.prospect.update({ where: { id }, data: { outreachStatus: "replied" } });
      await logActivity(session.user.id, "prospects", `Real reply detected from "${prospect.domain}"`);
    }

    return NextResponse.json({ prospect: updated, thread });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not retrieve this Gmail thread." },
      { status: 502 },
    );
  }
}
