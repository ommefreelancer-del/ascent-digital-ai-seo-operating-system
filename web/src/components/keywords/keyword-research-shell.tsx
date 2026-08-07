"use client";

import * as React from "react";
import { AlertTriangle, Bookmark, BookmarkCheck, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatRelativeTime } from "@/lib/utils";

interface ClassifiedKeyword {
  keyword: string;
  intent: "informational" | "navigational" | "commercial" | "transactional";
  intentRationale: string;
  metrics: { searchVolume: number; difficulty: number } | null;
}
interface TopicCluster {
  label: string;
  keywords: readonly string[];
}
interface KeywordResearchResult {
  classifiedKeywords: readonly ClassifiedKeyword[];
  topicClusters: readonly TopicCluster[];
  metricsAvailable: boolean;
  limitations: readonly string[];
  rankingDisclaimer: string;
}
interface SavedKeywordItem {
  id: string;
  keyword: string;
  intent: string;
  intentRationale: string;
  createdAt: string;
}

const intentTone: Record<string, "secondary" | "success" | "warning" | "default"> = {
  informational: "secondary",
  navigational: "default",
  commercial: "warning",
  transactional: "success",
};

export function KeywordResearchShell({ initialSaved }: { initialSaved: SavedKeywordItem[] }) {
  const { toast } = useToast();
  const [seedKeywords, setSeedKeywords] = React.useState("");
  const [businessObjective, setBusinessObjective] = React.useState("");
  const [targetAudience, setTargetAudience] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<KeywordResearchResult | null>(null);
  const [saved, setSaved] = React.useState(initialSaved);
  const [savingKeyword, setSavingKeyword] = React.useState<string | null>(null);

  const savedKeywordSet = React.useMemo(() => new Set(saved.map((s) => s.keyword)), [saved]);

  async function research(e: React.FormEvent) {
    e.preventDefault();
    const keywords = seedKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      setError("Add at least one seed keyword.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/keywords/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessObjective, seedKeywords: keywords, targetAudience: targetAudience || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Keyword research could not be completed.");
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Keyword research could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  async function saveKeyword(k: ClassifiedKeyword) {
    setSavingKeyword(k.keyword);
    try {
      const res = await fetch("/api/keywords/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: k.keyword, intent: k.intent, intentRationale: k.intentRationale }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Couldn't save keyword", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      setSaved((prev) => [data.saved, ...prev.filter((s) => s.keyword !== k.keyword)]);
    } catch {
      toast({ title: "Couldn't save keyword", description: "Check your connection and try again.", variant: "destructive" });
    } finally {
      setSavingKeyword(null);
    }
  }

  async function removeSaved(id: string) {
    const previous = saved;
    setSaved((prev) => prev.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/keywords/saved/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      setSaved(previous);
      toast({ title: "Couldn't remove keyword", description: "Please try again.", variant: "destructive" });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Research keywords</CardTitle>
            <CardDescription>Real classification, intent detection & topic clustering.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={research} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="seed-keywords">Seed keywords</Label>
                <Input id="seed-keywords" required placeholder="plumbing repair, emergency plumber" value={seedKeywords} onChange={(e) => setSeedKeywords(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Comma-separated, up to 20.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="objective">Business objective</Label>
                <Input id="objective" required placeholder="Generate leads for emergency plumbing calls" value={businessObjective} onChange={(e) => setBusinessObjective(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audience">Target audience (optional)</Label>
                <Input id="audience" placeholder="Homeowners with urgent plumbing issues" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} />
              </div>
              {error ? (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" /> {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" loading={loading} disabled={loading}>
                <Search className="h-4 w-4" /> Research
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Saved keywords</CardTitle>
            <CardDescription>{saved.length} saved</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 px-3 pb-3">
            {saved.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No saved keywords yet.</p>
            ) : (
              saved.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-xs hover:bg-accent">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.keyword}</p>
                    <p className="text-muted-foreground">
                      {s.intent} &middot; {formatRelativeTime(s.createdAt)}
                    </p>
                  </div>
                  <button onClick={() => removeSaved(s.id)} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        {!result ? (
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center">
            <Search className="h-8 w-8 text-muted-foreground/40" />
            <p className="max-w-sm text-sm text-muted-foreground">Research a set of seed keywords to see classified intent, volume/difficulty (if available), and topic clusters.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {!result.metricsAvailable ? (
              <Card className="border-warning/40 bg-warning/5">
                <CardContent className="flex items-start gap-2.5 p-4 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p>No live keyword-metrics provider is configured, so search volume & difficulty are unavailable for this run &mdash; intent classification and clustering are still real.</p>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Classified keywords</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Keyword</TableHead>
                      <TableHead>Intent</TableHead>
                      {result.metricsAvailable ? <TableHead>Volume</TableHead> : null}
                      {result.metricsAvailable ? <TableHead>Difficulty</TableHead> : null}
                      <TableHead className="text-right">Save</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.classifiedKeywords.map((k) => (
                      <TableRow key={k.keyword}>
                        <TableCell className="font-medium">{k.keyword}</TableCell>
                        <TableCell>
                          <Badge variant={intentTone[k.intent] ?? "secondary"}>{k.intent}</Badge>
                        </TableCell>
                        {result.metricsAvailable ? <TableCell>{k.metrics?.searchVolume ?? "--"}</TableCell> : null}
                        {result.metricsAvailable ? <TableCell>{k.metrics?.difficulty ?? "--"}</TableCell> : null}
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={savingKeyword === k.keyword}
                            onClick={() => saveKeyword(k)}
                            aria-label="Save keyword"
                          >
                            {savedKeywordSet.has(k.keyword) ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {result.topicClusters.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Topic clusters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.topicClusters.map((cluster, i) => (
                    <div key={i}>
                      <p className="mb-1.5 text-sm font-medium">{cluster.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {cluster.keywords.map((kw) => (
                          <Badge key={kw} variant="outline">
                            {kw}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <p className="text-xs text-muted-foreground">{result.rankingDisclaimer}</p>
            {result.limitations.length > 0 ? <p className="text-xs text-muted-foreground">Limitations: {result.limitations.join(" ")}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
