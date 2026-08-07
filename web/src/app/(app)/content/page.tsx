import { Topbar } from "@/components/layout/topbar";
import { ContentGeneratorShell } from "@/components/content/content-generator-shell";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

export default async function ContentPage() {
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const drafts = await db.contentDraft.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, type: true, title: true, createdAt: true },
  });

  return (
    <>
      <Topbar title="Content Generator" />
      <div className="flex-1 p-4 lg:p-6">
        <ContentGeneratorShell initialDrafts={drafts.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} />
      </div>
    </>
  );
}
