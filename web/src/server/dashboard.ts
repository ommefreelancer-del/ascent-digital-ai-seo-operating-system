import { db } from "@/server/db";
import { listAvailableAgents } from "@/server/backend/boss-agent";

/** Deterministic 0-100 rollup of a real SeoAudit's finding counts -- a documented weighting, never a fabricated metric. */
export function computeSeoHealthScore(criticalCount: number, warningCount: number, infoCount: number): number {
  const raw = 100 - criticalCount * 15 - warningCount * 5 - infoCount * 1;
  return Math.max(0, Math.min(100, raw));
}

export interface DashboardData {
  agentCount: number;
  activeProjects: number;
  totalProjects: number;
  projects: Array<{ id: string; name: string; domain: string | null; status: string; updatedAt: Date }>;
  seoHealthScore: number | null;
  latestAuditUrl: string | null;
  latestAuditAt: Date | null;
  recentActivity: Array<{ id: string; category: string; message: string; createdAt: Date }>;
  usage: { keywordsSaved: number; contentDrafts: number; reportsGenerated: number; chatMessages: number };
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const [agentIds, activeProjects, totalProjects, latestAudit, recentActivity, keywordsSaved, contentDrafts, reportsGenerated, chatMessages, projects] = await Promise.all([
    listAvailableAgents().catch(() => [] as readonly string[]),
    db.project.count({ where: { ownerId: userId, status: "active" } }),
    db.project.count({ where: { ownerId: userId } }),
    db.seoAudit.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
    db.activityEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.savedKeyword.count({ where: { userId } }),
    db.contentDraft.count({ where: { userId } }),
    db.report.count({ where: { userId } }),
    db.chatMessage.count({ where: { session: { userId } } }),
    db.project.findMany({ where: { ownerId: userId }, orderBy: { updatedAt: "desc" }, take: 5 }),
  ]);

  return {
    agentCount: agentIds.length,
    activeProjects,
    totalProjects,
    projects,
    seoHealthScore: latestAudit ? computeSeoHealthScore(latestAudit.criticalCount, latestAudit.warningCount, latestAudit.infoCount) : null,
    latestAuditUrl: latestAudit?.url ?? null,
    latestAuditAt: latestAudit?.createdAt ?? null,
    recentActivity,
    usage: { keywordsSaved, contentDrafts, reportsGenerated, chatMessages },
  };
}
