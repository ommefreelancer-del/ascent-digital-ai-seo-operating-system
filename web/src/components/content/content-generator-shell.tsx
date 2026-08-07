"use client";

import * as React from "react";
import { AlertTriangle, FileText, Layout, Loader2, Megaphone, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";

type ContentType = "blog" | "landing-page" | "meta" | "social";

const typeOptions: Array<{ value: ContentType; label: string; icon: typeof FileText; description: string }> = [
  { value: "blog", label: "Blog", icon: FileText, description: "Long-form article with sections & FAQs" },
  { value: "landing-page", label: "Landing Page", icon: Layout, description: "Conversion-focused page copy" },
  { value: "meta", label: "Meta", icon: Tag, description: "Meta title & description" },
  { value: "social", label: "Social", icon: Megaphone, description: "Caption composed from the generated copy" },
];

interface ContentSectionDraft {
  heading: string;
  body: string;
  isGenerated: boolean;
}
interface FaqItem {
  question: string;
  answerPlaceholder: string;
}
interface ContentPieceDraft {
  title: string;
  contentType: "website-page" | "blog-post";
  targetKeyword: string;
  metaTitle: string;
  metaDescription: string;
  sections: readonly ContentSectionDraft[];
  faqs: readonly FaqItem[];
  wordCountGuidance: string;
  internalLinks: readonly string[];
}
interface SeoContentResult {
  contentDrafts: readonly ContentPieceDraft[];
  dataAvailable: boolean;
  limitations: readonly string[];
}
interface DraftListItem {
  id: string;
  type: string;
  title: string;
  createdAt: string;
}

export function ContentGeneratorShell({ initialDrafts }: { initialDrafts: DraftListItem[] }) {
  const [type, setType] = React.useState<ContentType>("blog");
  const [topic, setTopic] = React.useState("");
  const [businessObjective, setBusinessObjective] = React.useState("");
  const [brandGuidelines, setBrandGuidelines] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SeoContentResult | null>(null);
  const [resultType, setResultType] = React.useState<ContentType>("blog");
  const [drafts, setDrafts] = React.useState(initialDrafts);
  const [historyLoadingId, setHistoryLoadingId] = React.useState<string | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, topic, businessObjective, brandGuidelines: brandGuidelines || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Content generation could not be completed.");
      setResult(data.result);
      setResultType(type);
      setDrafts((prev) => [{ id: data.draftId, type, title: data.result.contentDrafts[0]?.title ?? topic, createdAt: new Date().toISOString() }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Content generation could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDraft(id: string, draftType: string) {
    setHistoryLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/content/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load that draft.");
      setResult(data.result);
      setResultType(draftType as ContentType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that draft.");
    } finally {
      setHistoryLoadingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>AI writing workspace</CardTitle>
            <CardDescription>Real Keyword Research &rarr; Content Strategy &rarr; SEO Content pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={generate} className="space-y-3">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Content type">
                {typeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={type === opt.value}
                    onClick={() => setType(opt.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      type === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <opt.icon className="h-3.5 w-3.5" /> {opt.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="topic">Topic / seed keyword</Label>
                <Input id="topic" required placeholder="e.g. emergency plumbing repair" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="objective">Business objective</Label>
                <Textarea id="objective" required placeholder="e.g. Generate qualified leads for 24/7 emergency plumbing calls" value={businessObjective} onChange={(e) => setBusinessObjective(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand">Brand guidelines (optional)</Label>
                <Textarea id="brand" placeholder="Tone, voice, must-include phrases..." value={brandGuidelines} onChange={(e) => setBrandGuidelines(e.target.value)} />
              </div>
              {error ? (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" /> {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" loading={loading} disabled={loading}>
                <Sparkles className="h-4 w-4" /> Generate content
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent drafts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 px-3 pb-3">
            {drafts.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No drafts yet.</p>
            ) : (
              drafts.map((d) => (
                <button
                  key={d.id}
                  onClick={() => loadDraft(d.id, d.type)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{truncate(d.title, 30)}</span>
                    <span className="block text-muted-foreground">
                      {d.type} &middot; {formatRelativeTime(d.createdAt)}
                    </span>
                  </span>
                  {historyLoadingId === d.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        {!result ? (
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" />
            <p className="max-w-sm text-sm text-muted-foreground">Generate a piece of content to see the real pipeline output here.</p>
          </div>
        ) : (
          <ContentResults result={result} type={resultType} />
        )}
      </div>
    </div>
  );
}

function ContentResults({ result, type }: { result: SeoContentResult; type: ContentType }) {
  const draft = result.contentDrafts[0];
  if (!draft) {
    return <p className="text-sm text-muted-foreground">No content was produced for that request.</p>;
  }

  if (!result.dataAvailable) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="flex items-start gap-2.5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            No live content-generation provider is configured for this environment, so sections below are structural placeholders (marked <em>Placeholder</em>),
            not final AI-written copy.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{draft.title}</h2>
        <Badge variant="outline">{draft.contentType}</Badge>
        <Badge variant="secondary">{draft.targetKeyword}</Badge>
      </div>

      {type === "meta" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Meta tags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Meta title</p>
              <p className="text-sm font-medium">{draft.metaTitle}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Meta description</p>
              <p className="text-sm">{draft.metaDescription}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {type === "social" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Suggested social caption</CardTitle>
            <CardDescription>Composed from the generated meta description &mdash; there is no dedicated social-copy agent yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="rounded-lg bg-muted p-3 text-sm">{draft.metaDescription}</p>
          </CardContent>
        </Card>
      ) : null}

      {(type === "blog" || type === "landing-page") ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Meta tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Title: </span>
                {draft.metaTitle}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Description: </span>
                {draft.metaDescription}
              </p>
              <p className="text-xs text-muted-foreground">{draft.wordCountGuidance}</p>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {draft.sections.map((section, i) => (
              <Card key={i}>
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{section.heading}</h3>
                    <Badge variant={section.isGenerated ? "success" : "secondary"}>{section.isGenerated ? "Generated" : "Placeholder"}</Badge>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{section.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {draft.faqs.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">FAQs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {draft.faqs.map((faq, i) => (
                  <div key={i}>
                    <p className="text-sm font-medium">{faq.question}</p>
                    <p className="text-xs text-muted-foreground">{faq.answerPlaceholder}</p>
                    {i < draft.faqs.length - 1 ? <Separator className="mt-3" /> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {draft.internalLinks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Suggested internal links</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {draft.internalLinks.map((link, i) => (
                  <Badge key={i} variant="outline">
                    {link}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {result.limitations.length > 0 ? <p className="text-xs text-muted-foreground">Limitations: {result.limitations.join(" ")}</p> : null}
    </div>
  );
}
