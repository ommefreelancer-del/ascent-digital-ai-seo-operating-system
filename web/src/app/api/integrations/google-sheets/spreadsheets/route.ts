import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { listSpreadsheets } from "@/server/google-sheets";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const spreadsheets = await listSpreadsheets(session.user.id);
    return NextResponse.json({ spreadsheets, count: spreadsheets.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list Google Sheets spreadsheets." },
      { status: 502 },
    );
  }
}
