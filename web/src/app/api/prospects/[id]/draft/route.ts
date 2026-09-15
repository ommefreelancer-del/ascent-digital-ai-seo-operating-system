import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { createDraft, getDraft } from "@/server/gmail";
import { gmailDraftSchema } from "@/lib/validators";
import { logActivity } from "@/server/log-activity";

/** Retrieves the real Gmail draft currently prepared for this prospect, for review before approval. Read-only. */
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
  if (!prospect.gmailDraftId) {
    return NextResponse.json({ error: "No draft has been prepared for this prospect yet." }, { status: 409 });
  }

  try {
    const draft = await getDraft(session.user.id, prospect.gmailDraftId);
    return NextResponse.json({ prospect, draft });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not retrieve this Gmail draft." },
      { status: 502 },
    );
  }
}

/**
 * Creates a Gmail draft only -- never sends. This is the "agent/user
 * prepares" half of the required draft -> human approval -> send workflow;
 * the explicit send step lives at POST /api/prospects/[id]/send.
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

  const json = await request.json().catch(() => null);
  const parsed = gmailDraftSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const draft = await createDraft(session.user.id, {
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
      threadId: prospect.gmailThreadId ?? undefined,
    });

    const updated = await db.prospect.update({
      where: { id },
      data: {
        gmailDraftId: draft.id,
        gmailThreadId: draft.threadId,
        gmailLastMessageId: draft.messageId,
        outreachStatus: "drafted",
        email: prospect.email ?? parsed.data.to,
      },
    });

    await logActivity(session.user.id, "prospects", `Prepared a Gmail draft for "${prospect.domain}" -- awaiting approval to send`);
    return NextResponse.json({ prospect: updated, draft });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create the Gmail draft." },
      { status: 502 },
    );
  }
}
