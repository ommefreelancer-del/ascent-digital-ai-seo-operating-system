"use server";

// SPREADSHEET CLEANING APPROVAL -- SERVER ACTIONS (2026-09-02, WRITE-RESULT STATE FIX 2026-09-03):
// mirrors remediation-actions.ts's own established pattern EXACTLY (a real <form action={...}> submission
// via React 19's useActionState, robust against partial-hydration timing the way a plain onClick is not --
// see that file's own header for the real production interaction defect this convention fixes). NOT a
// second approval system: every action here calls straight into the SAME real approveCleaningApproval()/
// rejectCleaningApproval()/writeApprovedCleaningToGoogleSheets() functions the textual "reply approve"
// chat path (spreadsheet-processing.ts's resolveCleaningApprovalReply()) also calls -- only the transport
// differs. Nothing here ever decides anything on render or as a side effect of a chat message; the
// explicit button click (or native Enter-to-submit) remains the sole trigger.
//
// WRITE-RESULT STATE FIX (2026-09-03): a real, live-confirmed defect -- when a write attempt failed, this
// action used to return `status: "approved"` (the SAME status as "approved, write not yet attempted"),
// which the Workspace card rendered identically to a genuine success: a static "Approved" badge, the
// Approve button gone, no way to retry, while the destination spreadsheet stayed empty. The failure
// branch now returns the genuinely separate, DB-persisted "write_failed" status (see
// spreadsheet-google-sheets-writeback.ts's own header), and a new retryWriteToGoogleSheetsAction below
// lets the user retry the SAME write once the cause (e.g. a missing OAuth scope, a wrong destination) is
// fixed -- reusing the exact same writeApprovedCleaningToGoogleSheets() function, never a second write path.

import { getServerAuthSession } from "@/server/auth";
import { approveCleaningApproval, rejectCleaningApproval, getCleaningApprovalById } from "./spreadsheet-cleaning-approval";
import { getWriteDestinationSpreadsheet } from "@/server/google-sheets";
import { writeApprovedCleaningRespectingMode } from "./spreadsheet-existing-output-cleanup";
import { logActivity } from "@/server/log-activity";

export interface CleaningDecisionActionState {
  readonly ok: boolean;
  readonly error?: string;
  readonly status?: "approved" | "rejected" | "written" | "write_failed";
  readonly message?: string;
}

export async function approveCleaningApprovalAction(approvalId: string, _prevState: CleaningDecisionActionState | null, _formData: FormData): Promise<CleaningDecisionActionState> {
  const session = await getServerAuthSession();
  if (!session) {
    return { ok: false, error: "Unauthorized" };
  }
  const userId = session.user.id;

  const approved = await approveCleaningApproval(userId, approvalId);
  if (!approved.ok || !approved.record) {
    return { ok: false, error: approved.error };
  }
  const retainedCount = approved.record.result.retainedRowIndexes.length;
  await logActivity(userId, "workspace", `Approved a spreadsheet-cleaning result (${retainedCount} retained records).`);

  const selected = await getWriteDestinationSpreadsheet(userId);
  if (!selected) {
    return {
      ok: true,
      status: "approved",
      message: "Approved. No Google Sheets WRITE DESTINATION is currently configured -- go to Settings -> Integrations and choose a write destination (separate from the read-source picker), then approve again to write.",
    };
  }

  const dispatch = await writeApprovedCleaningRespectingMode(userId, approved.record, selected.id);
  if (dispatch.mode === "existing-tab-replace") {
    const writeResult = dispatch.result;
    if (!writeResult.ok) {
      await logActivity(userId, "workspace", `Approved a tab self-dedup cleanup, but the write to Google Sheets failed: ${writeResult.error}`);
      return { ok: true, status: "write_failed", message: `Approved, but the write to Google Sheets failed: ${writeResult.error} You can retry once this is fixed.` };
    }
    await logActivity(userId, "workspace", `Cleared and rewrote "${writeResult.tabName}" in "${selected.name}" with ${writeResult.rowsWritten} de-duplicated record(s).`);
    return {
      ok: true,
      status: "written",
      message: `"${writeResult.tabName}" in "${selected.name}" was cleared and rewritten with ${writeResult.rowsWritten} de-duplicated record(s).`,
    };
  }

  const writeResult = dispatch.result;
  if (!writeResult.ok) {
    await logActivity(userId, "workspace", `Approved a spreadsheet-cleaning result, but the write to Google Sheets failed: ${writeResult.error}`);
    return { ok: true, status: "write_failed", message: `Approved, but the write to Google Sheets failed: ${writeResult.error} You can retry once this is fixed.` };
  }
  await logActivity(
    userId,
    "workspace",
    `Wrote ${retainedCount} approved, cleaned record(s) to "${selected.name}" -- ${writeResult.adminVendorRowCount} to Admin/Vendor, ${writeResult.clientWebsiteRowCount} to Client Sheet.`,
  );
  return {
    ok: true,
    status: "written",
    message: `Written to "${selected.name}" -- ${writeResult.adminVendorRowCount} record(s) to Admin/Vendor, ${writeResult.clientWebsiteRowCount} record(s) to Client Sheet.`,
  };
}

export async function rejectCleaningApprovalAction(approvalId: string, _prevState: CleaningDecisionActionState | null, _formData: FormData): Promise<CleaningDecisionActionState> {
  const session = await getServerAuthSession();
  if (!session) {
    return { ok: false, error: "Unauthorized" };
  }
  const rejected = await rejectCleaningApproval(session.user.id, approvalId);
  if (!rejected.ok) {
    return { ok: false, error: rejected.error };
  }
  await logActivity(session.user.id, "workspace", "Rejected a spreadsheet-cleaning result -- nothing written to Google Sheets, original file untouched.");
  return { ok: true, status: "rejected", message: "Rejected -- nothing was written to Google Sheets." };
}

/**
 * Retries a real Google Sheets write for an approval whose PREVIOUS attempt failed ("write_failed"), or
 * that was approved but never attempted (no destination was configured at approval time, or approving
 * again would re-run the same approve step unnecessarily). Refuses for any other status -- especially
 * "written": a confirmed success can never be retried, so this can never duplicate an already-successful
 * write. Reuses the SAME writeApprovedCleaningToGoogleSheets(), which itself skips any tab a prior attempt
 * already wrote successfully (see that function's own header) -- so even a partial prior success is
 * retried safely, without re-sending rows that already landed.
 */
export async function retryWriteToGoogleSheetsAction(approvalId: string, _prevState: CleaningDecisionActionState | null, _formData: FormData): Promise<CleaningDecisionActionState> {
  const session = await getServerAuthSession();
  if (!session) {
    return { ok: false, error: "Unauthorized" };
  }
  const userId = session.user.id;

  const approval = await getCleaningApprovalById(userId, approvalId);
  if (!approval) {
    return { ok: false, error: "No such cleaning approval for this workspace." };
  }
  if (approval.status !== "approved" && approval.status !== "write_failed") {
    return { ok: false, error: `Nothing to retry -- this approval's status is "${approval.status}".` };
  }

  const selected = await getWriteDestinationSpreadsheet(userId);
  if (!selected) {
    return {
      ok: true,
      status: "write_failed",
      message: "Cannot retry -- no Google Sheets WRITE DESTINATION is currently configured. Go to Settings -> Integrations and choose one, then retry.",
    };
  }

  const dispatch = await writeApprovedCleaningRespectingMode(userId, approval, selected.id);
  if (dispatch.mode === "existing-tab-replace") {
    const writeResult = dispatch.result;
    if (!writeResult.ok) {
      await logActivity(userId, "workspace", `Retried the Google Sheets clear-and-replace write -- still failed: ${writeResult.error}`);
      return { ok: true, status: "write_failed", message: `Retry failed: ${writeResult.error} You can retry again once this is fixed.` };
    }
    await logActivity(userId, "workspace", `Retried and completed the clear-and-replace write for "${writeResult.tabName}" in "${selected.name}" (${writeResult.rowsWritten} de-duplicated record(s)).`);
    return {
      ok: true,
      status: "written",
      message: `"${writeResult.tabName}" in "${selected.name}" was cleared and rewritten with ${writeResult.rowsWritten} de-duplicated record(s).`,
    };
  }

  const writeResult = dispatch.result;
  if (!writeResult.ok) {
    await logActivity(userId, "workspace", `Retried the Google Sheets write for a spreadsheet-cleaning result -- still failed: ${writeResult.error}`);
    return { ok: true, status: "write_failed", message: `Retry failed: ${writeResult.error} You can retry again once this is fixed.` };
  }
  await logActivity(
    userId,
    "workspace",
    `Retried and completed the Google Sheets write for a spreadsheet-cleaning result -- wrote to "${selected.name}" (${writeResult.adminVendorRowCount} to Admin/Vendor, ${writeResult.clientWebsiteRowCount} to Client Sheet).`,
  );
  return {
    ok: true,
    status: "written",
    message: `Written to "${selected.name}" -- ${writeResult.adminVendorRowCount} record(s) to Admin/Vendor, ${writeResult.clientWebsiteRowCount} record(s) to Client Sheet.`,
  };
}
