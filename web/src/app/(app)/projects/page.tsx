import { Topbar } from "@/components/layout/topbar";
import { ProjectsShell } from "@/components/projects/projects-shell";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

export default async function ProjectsPage() {
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const projects = await db.project.findMany({
    where: { ownerId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { audits: true, reports: true, activities: true } } },
  });

  return (
    <>
      <Topbar title="Projects" />
      <div className="flex-1 p-4 lg:p-6">
        <ProjectsShell
          initialProjects={projects.map((p) => ({
            id: p.id,
            name: p.name,
            domain: p.domain,
            niche: p.niche,
            status: p.status,
            updatedAt: p.updatedAt.toISOString(),
            auditCount: p._count.audits,
            reportCount: p._count.reports,
            activityCount: p._count.activities,
          }))}
        />
      </div>
    </>
  );
}
