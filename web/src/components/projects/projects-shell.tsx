"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, FolderKanban, Gauge, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatRelativeTime } from "@/lib/utils";
import { projectSchema } from "@/lib/validators";

interface ProjectItem {
  id: string;
  name: string;
  domain: string | null;
  niche: string | null;
  status: string;
  updatedAt: string;
  auditCount: number;
  reportCount: number;
  activityCount: number;
}

const statusTone: Record<string, "success" | "warning" | "secondary"> = {
  active: "success",
  paused: "warning",
  completed: "secondary",
};

export function ProjectsShell({ initialProjects }: { initialProjects: ProjectItem[] }) {
  const [projects, setProjects] = React.useState(initialProjects);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [niche, setNiche] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = projectSchema.safeParse({ name, domain: domain || undefined, niche: niche || undefined, status: "active" });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the project.");
      setProjects((prev) => [
        { ...data.project, updatedAt: data.project.updatedAt, auditCount: 0, reportCount: 0, activityCount: 1 },
        ...prev,
      ]);
      setOpen(false);
      setName("");
      setDomain("");
      setNiche("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{projects.length} client project{projects.length === 1 ? "" : "s"}</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New project
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription>Add a client project to track audits, reports and activity.</DialogDescription>
            </DialogHeader>
            <form onSubmit={createProject} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="project-name">Name</Label>
                <Input id="project-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Plumbing Co." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-domain">Domain (optional)</Label>
                <Input id="project-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acmeplumbing.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-niche">Niche (optional)</Label>
                <Input id="project-niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Home services" />
              </div>
              {error ? (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" /> {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" loading={creating} disabled={creating}>
                  Create project
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center">
          <FolderKanban className="h-8 w-8 text-muted-foreground/40" />
          <p className="max-w-sm text-sm text-muted-foreground">No projects yet. Create your first client project to start tracking audits and reports.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{p.name}</CardTitle>
                    <p className="truncate text-xs text-muted-foreground">{p.domain ?? "No domain set"}</p>
                  </div>
                  <Badge variant={statusTone[p.status] ?? "secondary"}>{p.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {p.niche ? <p className="text-xs text-muted-foreground">{p.niche}</p> : null}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Gauge className="h-3.5 w-3.5" /> {p.auditCount} audits
                    </span>
                    <span>{p.reportCount} reports</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Updated {formatRelativeTime(p.updatedAt)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
