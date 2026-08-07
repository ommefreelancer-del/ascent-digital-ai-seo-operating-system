import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { ProjectDetailShell } from "@/components/projects/project-detail-shell";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const project = await db.project.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      activities: { orderBy: { createdAt: "desc" }, take: 30 },
      audits: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, url: true, criticalCount: true, warningCount: true, infoCount: true, createdAt: true } },
      reports: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, title: true, type: true, createdAt: true } },
    },
  });
  if (!project) notFound();

  return (
    <>
      <Topbar title={project.name} />
      <div className="flex-1 p-4 lg:p-6">
        <ProjectDetailShell
          project={{
            id: project.id,
            name: project.name,
            domain: project.domain,
            niche: project.niche,
            status: project.status,
            createdAt: project.createdAt.toISOString(),
            activities: project.activities.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
            audits: project.audits.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
            reports: project.reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
          }}
        />
      </div>
    </>
  );
}
