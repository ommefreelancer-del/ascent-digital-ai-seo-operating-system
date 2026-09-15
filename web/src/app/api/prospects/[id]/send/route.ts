import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { sendDraft } from "@/server/gmail";
import { logActivity } from "@/server/log-activity";

/**
 * The ONLY route in this app that ever calls gmail.ts's sendDraft(). Never
 * triggered automatically -- requires a real, explicit user action (this
 * POST) with an explicit `confirm: true` body, matching GLOBAL_RULES.md
 * SS9's human-approval requirement for "Executing automations that change
 * external systems". Sends exactly the draft already prepared and reviewed
 * via POST /api/prospects/[id]/draft -- no new content is composed here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prospect = await db.prospect.findFirst({ where: { id, userId: session.user.id } });
  if (!prospect) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!prospect.gmailDraftId) {
    return NextResponse.json({ error: "No draft has been prepared for this prospect yet." }, { status: 409 });
  }

  const json = await request.json().catch(() => null);
  if (!json || json.confirm !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required to send (confirm: true)." }, { status: 400 });
  }

  try {
    const sent = await sendDraft(session.user.id, prospect.gmailDraftId);

    const updated = await db.prospect.update({
      where: { id },
      data: {
        outreachStatus: "sent",
        lastContactedAt: new Date(),
        gmailLastMessageId: sent.messageId,
        gmailDraftId: null,
      },
    });

    await logActivity(session.user.id, "prospects", `Sent outreach email to "${prospect.domain}" (explicitly approved)`);
    return NextResponse.json({ prospect: updated, sent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not send this draft." },
      { status: 502 },
    );
  }
}
