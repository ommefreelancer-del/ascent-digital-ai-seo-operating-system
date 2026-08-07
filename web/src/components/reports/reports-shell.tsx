"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Download, FileBarChart, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime, truncate } from "@/lib/utils";

// Charts (recharts + its d3-* deps) are only needed once a chart-bearing
// report is opened -- dynamic-import them client-only so they don't bloat
// every /reports page load.
const ChartSkeleton = () => <Skeleton className="h-64 w-full" />;
const AiUsageView = dynamic(() => import("./chart-views").then((m) => m.AiUsageView), { ssr: false, loading: ChartSkeleton });
const KeywordGrowthView = dynamic(() => import("./chart-views").then((m) => m.KeywordGrowthView), { ssr: false, loading: ChartSkeleton });

interface ReportListItem {
  id: string;
  title: string;
  type: string;
  createdAt: string;
}

interface LoadedReport {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  result: any;
}

const typeLabel: Record<string, string> = {
  "seo-performance": "SEO Performance",
  "ai-usage": "AI Usage",
  "keyword-growth": "Keyword Growth",
};

export function ReportsShell({ projects, initialReports }: { projects: Array<{ id: string; name: string }>; initialReports: ReportListItem[] }) {
  const [reports, setReports] = React.useState(initialReports);
  const [active, setActive] = React.useState<LoadedReport | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [clientName, setClientName] = React.useState("");
  const [periodLabel, setPeriodLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [generating, setGenerating] = React.useState<string | null>(null);

  function addToList(reportId: string, title: string, type: string, result: any) {
    const createdAt = new Date().toISOString();
    setReports((prev) => [{ id: reportId, title, type, createdAt }, ...prev]);
    setActive({ id: reportId, title, type, createdAt, result });
  }

  async function generateSeoPerformance(e: React.FormEvent) {
    e.preventDefault();
    setGenerating("seo-performance");
    setError(null);
    try {
      const res = await fetch("/api/reports/seo-performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, reportingPeriodLabel: periodLabel, url, projectId: projectId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The report could not be generated.");
      addToList(data.reportId, `${clientName} — ${periodLabel}`, "seo-performance", data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The report could not be generated.");
    } finally {
      setGenerating(null);
    }
  }

  async function generateAiUsage() {
    setGenerating("ai-usage");
    setError(null);
    try {
      const res = await fetch("/api/reports/ai-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodDays: 30 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The report could not be generated.");
      addToList(data.reportId, `AI Usage — ${data.result.periodLabel}`, "ai-usage", data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The report could not be generated.");
    } finally {
      setGenerating(null);
    }
  }

  async function generateKeywordGrowth() {
    setGenerating("keyword-growth");
    setError(null);
    try {
      const res = await fetch("/api/reports/keyword-growth", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The report could not be generated.");
      addToList(data.reportId, `Keyword Growth — ${new Date().toLocaleDateString()}`, "keyword-growth", data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The report could not be generated.");
    } finally {
      setGenerating(null);
    }
  }

  async function loadReport(id: string) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load that report.");
      setActive(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that report.");
    } finally {
      setLoadingId(null);
    }
  }

  function downloadJson() {
    if (!active) return;
    const blob = new Blob([JSON.stringify(active.result, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${active.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Generate a report</CardTitle>
            <CardDescription>SEO performance, AI usage & keyword growth.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="seo-performance">
              <TabsList className="w-full">
                <TabsTrigger value="seo-performance" className="flex-1">
                  SEO
                </TabsTrigger>
                <TabsTrigger value="ai-usage" className="flex-1">
                  AI Usage
                </TabsTrigger>
                <TabsTrigger value="keyword-growth" className="flex-1">
                  Keywords
                </TabsTrigger>
              </TabsList>

              <TabsContent value="seo-performance">
                <form onSubmit={generateSeoPerformance} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="client-name">Client name</Label>
                    <Input id="client-name" required value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Acme Plumbing Co." />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="period-label">Reporting period</Label>
                    <Input id="period-label" required value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="July 2026" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="report-url">Website URL</Label>
                    <Input id="report-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
                  </div>
                  {projects.length > 0 ? (
                    <div className="space-y-1.5">
                      <Label>Project (optional)</Label>
                      <Select value={projectId} onValueChange={setProjectId}>
                        <SelectTrigger>
                          <SelectValue placeholder="No project" />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <Button type="submit" className="w-full" loading={generating === "seo-performance"} disabled={!!generating}>
                    Generate report
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="ai-usage" className="space-y-3">
                <p className="text-sm text-muted-foreground">Rolls up real routing decisions from your AI Workspace sessions over the last 30 days.</p>
                <Button onClick={generateAiUsage} className="w-full" loading={generating === "ai-usage"} disabled={!!generating}>
                  Generate report
                </Button>
              </TabsContent>

              <TabsContent value="keyword-growth" className="space-y-3">
                <p className="text-sm text-muted-foreground">Rolls up your saved keywords by intent and by week.</p>
                <Button onClick={generateKeywordGrowth} className="w-full" loading={generating === "keyword-growth"} disabled={!!generating}>
                  Generate report
                </Button>
              </TabsContent>
            </Tabs>
            {error ? (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 px-3 pb-3">
            {reports.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No reports yet.</p>
            ) : (
              reports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadReport(r.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{truncate(r.title, 32)}</span>
                    <span className="block text-muted-foreground">
                      {typeLabel[r.type] ?? r.type} &middot; {formatRelativeTime(r.createdAt)}
                    </span>
                  </span>
                  {loadingId === r.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        {!active ? (
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center">
            <FileBarChart className="h-8 w-8 text-muted-foreground/40" />
            <p className="max-w-sm text-sm text-muted-foreground">Generate or select a report to view it here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{active.title}</h2>
                <Badge variant="outline">{typeLabel[active.type] ?? active.type}</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={downloadJson}>
                  <Download className="h-3.5 w-3.5" /> Download JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
              </div>
            </div>
            {active.type === "seo-performance" ? <SeoPerformanceView result={active.result} /> : null}
            {active.type === "ai-usage" ? <AiUsageView result={active.result} /> : null}
            {active.type === "keyword-growth" ? <KeywordGrowthView result={active.result} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SeoPerformanceView({ result }: { result: any }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Executive summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{result.executiveSummary}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">KPI dashboard</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {result.kpiDashboard?.map((kpi: any, i: number) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="text-lg font-semibold">{kpi.value}</p>
              <Badge variant={kpi.trend === "improving" ? "success" : kpi.trend === "declining" ? "destructive" : "secondary"} className="mt-1">
                {kpi.trend}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recommendations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {result.recommendations?.map((r: any, i: number) => (
            <div key={i} className="rounded-lg border border-border p-3 text-sm">
              <Badge variant={r.priority === "high" ? "destructive" : r.priority === "medium" ? "warning" : "secondary"}>{r.priority}</Badge>
              <p className="mt-1.5">{r.recommendation}</p>
              <p className="text-xs text-muted-foreground">{r.rationale}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      {!result.dataAvailable ? (
        <p className="text-xs text-muted-foreground">Some performance metrics are unavailable: no live performance data provider is configured for this environment.</p>
      ) : null}
    </div>
  );
}

