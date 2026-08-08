import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { listAccounts } from "@/server/google-business-profile";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accounts = await listAccounts(session.user.id);
    return NextResponse.json({ accounts, count: accounts.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list Business Profile accounts." },
      { status: 502 },
    );
  }
}
