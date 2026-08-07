import { Topbar } from "@/components/layout/topbar";
import { KeywordResearchShell } from "@/components/keywords/keyword-research-shell";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

export default async function KeywordsPage() {
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const saved = await db.savedKeyword.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <Topbar title="Keyword Research" />
      <div className="flex-1 p-4 lg:p-6">
        <KeywordResearchShell initialSaved={saved.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))} />
      </div>
    </>
  );
}
