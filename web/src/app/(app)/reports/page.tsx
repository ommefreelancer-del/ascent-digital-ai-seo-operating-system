import { Topbar } from "@/components/layout/topbar";
import { ReportsShell } from "@/components/reports/reports-shell";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

export default async function ReportsPage() {
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const [reports, projects] = await Promise.all([
    db.report.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, title: true, type: true, createdAt: true },
    }),
    db.project.findMany({ where: { ownerId: session.user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <Topbar title="Reports" />
      <div className="flex-1 p-4 lg:p-6">
        <ReportsShell
          projects={projects}
          initialReports={reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        />
      </div>
    </>
  );
}
