"use client";

import { TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Split out from reports-shell.tsx and loaded via next/dynamic so recharts
// (and its d3-* dependencies) are only fetched once a chart-bearing report is
// actually opened, instead of bloating the initial /reports bundle.

export function AiUsageView({ result }: { result: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatBox label="Sessions" value={result.sessionCount} />
        <StatBox label="Messages" value={result.totalMessages} />
        <StatBox label="Assigned" value={result.tasksByStatus?.assigned ?? 0} />
        <StatBox label="Escalated" value={result.tasksByStatus?.escalated ?? 0} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top agents by task volume</CardTitle>
        </CardHeader>
        <CardContent>
          {!result.topAgents || result.topAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks were routed to a specialist agent in this period.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.topAgents} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="agentId" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function KeywordGrowthView({ result }: { result: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatBox label="Total saved" value={result.totalSaved} />
        <StatBox label="Last 30 days" value={result.last30Days} icon={TrendingUp} />
        <StatBox label="Intent categories" value={result.byIntent?.length ?? 0} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Weekly saved-keyword growth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.weeklySeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="weekStart" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">By intent</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {result.byIntent?.map((i: any) => (
            <Badge key={i.intent} variant="outline">
              {i.intent}: {i.count}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ label, value, icon: Icon }: { label: string; value: number; icon?: typeof TrendingUp }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
          {label}
        </div>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
