import { db } from "@/server/db";

export interface AiUsageReport {
  readonly periodDays: number;
  readonly periodLabel: string;
  readonly sessionCount: number;
  readonly totalMessages: number;
  readonly tasksByStatus: { readonly assigned: number; readonly escalated: number; readonly rejected: number };
  readonly topAgents: ReadonlyArray<{ agentId: string; count: number }>;
  readonly generatedAt: string;
}

/** Real usage rollup from this user's own ChatSession/ChatMessage rows -- no backend agent call, since no such analytics agent exists. Every number traces to a real, persisted routing outcome. */
export async function buildAiUsageReport(userId: string, periodDays = 30): Promise<AiUsageReport> {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const [sessionCount, assistantMessages] = await Promise.all([
    db.chatSession.count({ where: { userId, createdAt: { gte: since } } }),
    db.chatMessage.findMany({
      where: { role: "assistant", createdAt: { gte: since }, session: { userId } },
      select: { agentId: true, status: true },
    }),
  ]);

  const tasksByStatus = { assigned: 0, escalated: 0, rejected: 0 };
  const agentCounts = new Map<string, number>();
  for (const m of assistantMessages) {
    if (m.status === "assigned") tasksByStatus.assigned += 1;
    else if (m.status === "escalated") tasksByStatus.escalated += 1;
    else if (m.status === "rejected") tasksByStatus.rejected += 1;
    if (m.agentId) agentCounts.set(m.agentId, (agentCounts.get(m.agentId) ?? 0) + 1);
  }
  const topAgents = [...agentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([agentId, count]) => ({ agentId, count }));

  return {
    periodDays,
    periodLabel: `Last ${periodDays} days`,
    sessionCount,
    totalMessages: assistantMessages.length,
    tasksByStatus,
    topAgents,
    generatedAt: new Date().toISOString(),
  };
}

export interface KeywordGrowthReport {
  readonly totalSaved: number;
  readonly last30Days: number;
  readonly byIntent: ReadonlyArray<{ intent: string; count: number }>;
  readonly weeklySeries: ReadonlyArray<{ weekStart: string; count: number }>;
  readonly generatedAt: string;
}

/** Real growth rollup from this user's own SavedKeyword rows -- no backend agent call, since keyword volume over time isn't something any agent tracks. */
export async function buildKeywordGrowthReport(userId: string): Promise<KeywordGrowthReport> {
  const saved = await db.savedKeyword.findMany({ where: { userId }, select: { intent: true, createdAt: true } });

  const intentCounts = new Map<string, number>();
  for (const s of saved) {
    intentCounts.set(s.intent, (intentCounts.get(s.intent) ?? 0) + 1);
  }

  const now = Date.now();
  const weeks = 8;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(now - (weeks - i) * weekMs);
    return { weekStart: start.toISOString().slice(0, 10), count: 0 };
  });
  for (const s of saved) {
    const age = now - s.createdAt.getTime();
    const bucketIndex = weeks - 1 - Math.floor(age / weekMs);
    if (bucketIndex >= 0 && bucketIndex < weeks) {
      buckets[bucketIndex]!.count += 1;
    }
  }

  const last30Days = saved.filter((s) => now - s.createdAt.getTime() <= 30 * 24 * 60 * 60 * 1000).length;

  return {
    totalSaved: saved.length,
    last30Days,
    byIntent: [...intentCounts.entries()].map(([intent, count]) => ({ intent, count })),
    weeklySeries: buckets,
    generatedAt: new Date().toISOString(),
  };
}
