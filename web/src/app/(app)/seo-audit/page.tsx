import { Topbar } from "@/components/layout/topbar";
import { SeoAuditShell } from "@/components/seo-audit/seo-audit-shell";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

export default async function SeoAuditPage() {
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const [projects, audits] = await Promise.all([
    db.project.findMany({ where: { ownerId: session.user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.seoAudit.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, url: true, criticalCount: true, warningCount: true, infoCount: true, createdAt: true },
    }),
  ]);

  return (
    <>
      <Topbar title="SEO Audit" />
      <div className="flex-1 p-4 lg:p-6">
        <SeoAuditShell
          projects={projects}
          initialAudits={audits.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
        />
      </div>
    </>
  );
}
