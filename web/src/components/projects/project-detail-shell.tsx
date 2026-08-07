"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Activity, FileText, Gauge, Globe, Tag, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { formatRelativeTime, truncate } from "@/lib/utils";

interface ProjectActivity {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}
interface AuditItem {
  id: string;
  url: string;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  createdAt: string;
}
interface ReportItem {
  id: string;
  title: string;
  type: string;
  createdAt: string;
}
interface ProjectDetail {
  id: string;
  name: string;
  domain: string | null;
  niche: string | null;
  status: string;
  createdAt: string;
  activities: ProjectActivity[];
  audits: AuditItem[];
  reports: ReportItem[];
}

const statusTone: Record<string, "success" | "warning" | "secondary"> = {
  active: "success",
  paused: "warning",
  completed: "secondary",
};

export function ProjectDetailShell({ project }: { project: ProjectDetail }) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = React.useState(project.status);
  const [deleting, setDeleting] = React.useState(false);

  async function updateStatus(next: string) {
    const previous = status;
    setStatus(next);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Update failed");
      router.refresh();
    } catch {
      setStatus(previous);
      toast({ title: "Couldn't update status", description: "Please try again.", variant: "destructive" });
    }
  }

  async function deleteProject() {
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ title: "Couldn't delete project", description: "Please try again.", variant: "destructive" });
        return;
      }
      router.push("/projects");
      router.refresh();
    } catch {
      toast({ title: "Couldn't delete project", description: "Check your connection and try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{project.name}</h2>
              <Badge variant={statusTone[status] ?? "secondary"}>{status}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {project.domain ? (
                <span className="flex items-center gap-1">
                  <Globe className="h-3.5 w-3.5" /> {project.domain}
                </span>
              ) : null}
              {project.niche ? (
                <span className="flex items-center gap-1">
                  <Tag className="h-3.5 w-3.5" /> {project.niche}
                </span>
              ) : null}
              <span>Created {formatRelativeTime(project.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={updateStatus}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={deleteProject} disabled={deleting} aria-label="Delete project">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" /> Activity timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {project.activities.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="space-y-4">
                {project.activities.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <div>
                      <p>{a.message}</p>
                      <p className="text-xs text-muted-foreground">{formatRelativeTime(a.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="h-4 w-4 text-primary" /> Recent audits
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.audits.length === 0 ? (
                <p className="text-xs text-muted-foreground">No audits run for this project yet.</p>
              ) : (
                project.audits.map((audit) => (
                  <div key={audit.id} className="rounded-md border border-border px-2.5 py-2 text-xs">
                    <p className="truncate font-medium">{truncate(audit.url, 30)}</p>
                    <p className="text-muted-foreground">
                      {audit.criticalCount} critical &middot; {audit.warningCount} warnings &middot; {formatRelativeTime(audit.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-primary" /> Recent reports
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.reports.length === 0 ? (
                <p className="text-xs text-muted-foreground">No reports generated for this project yet.</p>
              ) : (
                project.reports.map((report) => (
                  <div key={report.id} className="rounded-md border border-border px-2.5 py-2 text-xs">
                    <p className="truncate font-medium">{report.title}</p>
                    <p className="text-muted-foreground">
                      {report.type} &middot; {formatRelativeTime(report.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
