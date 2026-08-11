import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getSpreadsheetValues, setSelectedSpreadsheet, listSpreadsheets } from "@/server/google-sheets";
import { googleSheetsValuesSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = googleSheetsValuesSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const values = await getSpreadsheetValues(session.user.id, parsed.data.spreadsheetId, parsed.data.range);

    // Best-effort: remember which spreadsheet was selected, matching
    // GoogleSearchConsoleConnection.selectedSiteUrl's persistence pattern.
    // Never blocks the real read result on this succeeding.
    try {
      const spreadsheets = await listSpreadsheets(session.user.id);
      const match = spreadsheets.find((s) => s.id === parsed.data.spreadsheetId);
      if (match) await setSelectedSpreadsheet(session.user.id, match.id, match.name);
    } catch {
      // Non-fatal -- the real values response below is unaffected.
    }

    return NextResponse.json({ spreadsheetId: parsed.data.spreadsheetId, values });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read Google Sheets values." },
      { status: 502 },
    );
  }
}
