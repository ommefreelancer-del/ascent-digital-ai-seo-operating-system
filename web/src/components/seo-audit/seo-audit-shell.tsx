"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Gauge, Info, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRelativeTime, truncate } from "@/lib/utils";

interface AuditFinding {
  category: string;
  severity: "info" | "warning" | "critical";
  message: string;
  recommendation: string;
}

interface WebsiteAuditResult {
  url: string | null;
  findings: readonly AuditFinding[];
  summary: { criticalCount: number; warningCount: number; infoCount: number };
  limitations: readonly string[];
}

interface OnPageRecommendation {
  category: string;
  priority: "high" | "medium" | "low";
  recommendation: string;
  rationale: string;
}

interface OnPageSeoResult {
  targetKeyword: string;
  recommendations: readonly OnPageRecommendation[];
  crossFunctionalNotes: readonly string[];
  limitations: readonly string[];
}

interface TechnicalSeoRecommendation {
  category: string;
  priority: "high" | "medium" | "low";
  recommendation: string;
  rationale: string;
  confirmedByCrossFunctionalNote: boolean;
}

interface TechnicalSeoResult {
  recommendations: readonly TechnicalSeoRecommendation[];
  limitations: readonly string[];
}

interface CrawledPageSummary {
  url: string;
  status: number | null;
  error: string | null;
}

interface CrawlSummary {
  runId: string;
  startUrl: string;
  pagesCrawled: number;
  pages: readonly CrawledPageSummary[];
  robotsTxtChecked: boolean;
  robotsTxtFound: boolean;
  sitemapChecked: boolean;
  sitemapUrlsFound: number;
  decidedAt: string;
}

interface LighthouseSummary {
  available: boolean;
  coreWebVitals: { lcpMs: number | null; inpMs: number | null; cls: number | null } | null;
  categoryScores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null } | null;
}

interface FullAuditResult {
  websiteAudit: WebsiteAuditResult;
  onPageSeo: OnPageSeoResult;
  technicalSeo: TechnicalSeoResult;
  crawl: CrawlSummary;
  lighthouse: LighthouseSummary;
}

interface AuditListItem {
  id: string;
  url: string;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  createdAt: string;
}

const priorityTone: Record<string, "destructive" | "warning" | "secondary"> = {
  high: "destructive",
  medium: "warning",
  low: "secondary",
};

const severityTone: Record<string, "destructive" | "warning" | "secondary"> = {
  critical: "destructive",
  warning: "warning",
  info: "secondary",
};

export function SeoAuditShell({ projects, initialAudits }: { projects: Array<{ id: string; name: string }>; initialAudits: AuditListItem[] }) {
  const [url, setUrl] = React.useState("");
  const [targetKeyword, setTargetKeyword] = React.useState("");
  const [projectId, setProjectId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<FullAuditResult | null>(null);
  const [activeUrl, setActiveUrl] = React.useState<string | null>(null);
  const [audits, setAudits] = React.useState<AuditListItem[]>(initialAudits);
  const [historyLoadingId, setHistoryLoadingId] = React.useState<string | null>(null);

  async function runAudit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/seo-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, targetKeyword, projectId: projectId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The audit could not be completed.");
      setResult(data.result);
      setActiveUrl(url);
      setAudits((prev) => [
        {
          id: data.auditId,
          url,
          criticalCount: data.result.websiteAudit.summary.criticalCount,
          warningCount: data.result.websiteAudit.summary.warningCount,
          infoCount: data.result.websiteAudit.summary.infoCount,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The audit could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit(id: string) {
    setHistoryLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/seo-audit/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load that audit.");
      setResult(data.result);
      setActiveUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that audit.");
    } finally {
      setHistoryLoadingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Run a website audit</CardTitle>
            <CardDescription>Technical, on-page & structural SEO checks against real page HTML.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={runAudit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="audit-url">Website URL</Label>
                <Input id="audit-url" type="url" required placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audit-keyword">Target keyword</Label>
                <Input id="audit-keyword" required placeholder="e.g. commercial plumbing services" value={targetKeyword} onChange={(e) => setTargetKeyword(e.target.value)} />
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
              {error ? (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" /> {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" loading={loading} disabled={loading}>
                <Gauge className="h-4 w-4" /> Run audit
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent audits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 px-3 pb-3">
            {audits.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No audits yet.</p>
            ) : (
              audits.map((a) => (
                <button
                  key={a.id}
                  onClick={() => loadAudit(a.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{truncate(a.url, 28)}</span>
                    <span className="block text-muted-foreground">{formatRelativeTime(a.createdAt)}</span>
                  </span>
                  {historyLoadingId === a.id ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <span className="shrink-0 text-muted-foreground">{a.criticalCount + a.warningCount + a.infoCount}</span>
                  )}
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        {!result ? (
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center">
            <Gauge className="h-8 w-8 text-muted-foreground/40" />
            <p className="max-w-sm text-sm text-muted-foreground">Run an audit to see technical SEO, on-page SEO and structural findings for a real page.</p>
          </div>
        ) : (
          <AuditResults result={result} url={activeUrl} />
        )}
      </div>
    </div>
  );
}

function AuditResults({ result, url }: { result: FullAuditResult; url: string | null }) {
  const { websiteAudit, onPageSeo, technicalSeo, crawl, lighthouse } = result;
  const topRecommendations = [...technicalSeo.recommendations, ...onPageSeo.recommendations]
    .filter((r) => r.priority === "high")
    .slice(0, 6);

  return (
    <div className="space-y-4">
      {url ? <p className="truncate text-sm text-muted-foreground">Results for {url}</p> : null}

      {crawl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Live crawl &amp; performance evidence</CardTitle>
            <CardDescription>
              Run <code className="text-xs">{crawl.runId}</code> &middot; {new Date(crawl.decidedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <EvidenceStat label="Pages crawled" value={String(crawl.pagesCrawled)} />
              <EvidenceStat label="robots.txt" value={crawl.robotsTxtFound ? "Found" : "Not found (checked)"} />
              <EvidenceStat label="sitemap.xml URLs" value={String(crawl.sitemapUrlsFound)} />
              <EvidenceStat
                label="Lighthouse"
                value={lighthouse?.available ? "Executed" : "Not verifiable"}
              />
            </div>
            {lighthouse?.available ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <EvidenceStat label="LCP" value={lighthouse.coreWebVitals?.lcpMs != null ? `${Math.round(lighthouse.coreWebVitals.lcpMs)}ms` : "—"} />
                <EvidenceStat label="CLS" value={lighthouse.coreWebVitals?.cls != null ? lighthouse.coreWebVitals.cls.toFixed(2) : "—"} />
                <EvidenceStat label="Perf" value={lighthouse.categoryScores?.performance != null ? String(lighthouse.categoryScores.performance) : "—"} />
                <EvidenceStat label="A11y" value={lighthouse.categoryScores?.accessibility != null ? String(lighthouse.categoryScores.accessibility) : "—"} />
                <EvidenceStat label="Best Pr." value={lighthouse.categoryScores?.bestPractices != null ? String(lighthouse.categoryScores.bestPractices) : "—"} />
                <EvidenceStat label="SEO" value={lighthouse.categoryScores?.seo != null ? String(lighthouse.categoryScores.seo) : "—"} />
              </div>
            ) : null}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">{crawl.pages.length} crawled page(s)</summary>
              <ul className="mt-2 space-y-1">
                {crawl.pages.map((p) => (
                  <li key={p.url} className="flex items-center justify-between gap-2">
                    <span className="truncate">{p.url}</span>
                    <span className={p.status === 200 ? "text-success" : "text-warning"}>{p.status ?? p.error ?? "?"}</span>
                  </li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard icon={XCircle} tone="text-destructive" label="Critical" value={websiteAudit.summary.criticalCount} />
        <SummaryCard icon={AlertTriangle} tone="text-warning" label="Warnings" value={websiteAudit.summary.warningCount} />
        <SummaryCard icon={Info} tone="text-muted-foreground" label="Info" value={websiteAudit.summary.infoCount} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="technical">Technical SEO</TabsTrigger>
          <TabsTrigger value="onpage">On-Page SEO</TabsTrigger>
          <TabsTrigger value="findings">All Findings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top recommendations</CardTitle>
              <CardDescription>High-priority items from technical & on-page SEO analysis</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {topRecommendations.length === 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" /> No high-priority issues found.
                </p>
              ) : (
                topRecommendations.map((r, i) => (
                  <div key={i} className="rounded-lg border border-border p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="destructive">high priority</Badge>
                      <span className="text-xs text-muted-foreground">{r.category}</span>
                    </div>
                    <p>{r.recommendation}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          {websiteAudit.limitations.length > 0 && (
            <p className="text-xs text-muted-foreground">Limitations: {websiteAudit.limitations.join(" ")}</p>
          )}
        </TabsContent>

        <TabsContent value="technical" className="space-y-2.5">
          {technicalSeo.recommendations.length === 0 ? (
            <EmptyPanel message="No technical SEO recommendations." />
          ) : (
            technicalSeo.recommendations.map((r, i) => <RecommendationCard key={i} category={r.category} priority={r.priority} recommendation={r.recommendation} rationale={r.rationale} />)
          )}
        </TabsContent>

        <TabsContent value="onpage" className="space-y-2.5">
          {onPageSeo.recommendations.length === 0 ? (
            <EmptyPanel message="No on-page SEO recommendations." />
          ) : (
            onPageSeo.recommendations.map((r, i) => <RecommendationCard key={i} category={r.category} priority={r.priority} recommendation={r.recommendation} rationale={r.rationale} />)
          )}
        </TabsContent>

        <TabsContent value="findings" className="space-y-2.5">
          {websiteAudit.findings.length === 0 ? (
            <EmptyPanel message="No structural findings." />
          ) : (
            websiteAudit.findings.map((f, i) => (
              <Card key={i}>
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex items-center gap-2">
                    <Badge variant={severityTone[f.severity]}>{f.severity}</Badge>
                    <span className="text-xs text-muted-foreground">{f.category}</span>
                  </div>
                  <p className="text-sm">{f.message}</p>
                  <p className="text-xs text-muted-foreground">{f.recommendation}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RecommendationCard({ category, priority, recommendation, rationale }: { category: string; priority: string; recommendation: string; rationale: string }) {
  return (
    <Card>
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-center gap-2">
          <Badge variant={priorityTone[priority] ?? "secondary"}>{priority}</Badge>
          <span className="text-xs text-muted-foreground">{category}</span>
        </div>
        <p className="text-sm">{recommendation}</p>
        <p className="text-xs text-muted-foreground">{rationale}</p>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ icon: Icon, tone, label, value }: { icon: typeof XCircle; tone: string; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={`h-5 w-5 ${tone}`} />
        <div>
          <p className="text-xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="truncate text-sm font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
      <CheckCircle2 className="h-6 w-6 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
