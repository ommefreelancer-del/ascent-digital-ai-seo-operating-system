import Link from "next/link";
import { Activity, ArrowUpRight, Bot, FileText, FolderKanban, Gauge, MessageSquare, Search, Sparkles, TrendingUp } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getServerAuthSession } from "@/server/auth";
import { getDashboardData } from "@/server/dashboard";
import { formatRelativeTime, truncate } from "@/lib/utils";
import { redirect } from "next/navigation";

const quickActions = [
  { href: "/workspace", label: "Ask the AI Workspace", description: "Route a task to the right specialist agent", icon: Sparkles },
  { href: "/seo-audit", label: "Run a website audit", description: "Technical, on-page & performance checks", icon: Gauge },
  { href: "/content", label: "Generate content", description: "Blog, landing page, meta or social copy", icon: FileText },
  { href: "/keywords", label: "Research keywords", description: "Volume, difficulty, intent & suggestions", icon: Search },
];

const statusTone: Record<string, "success" | "warning" | "secondary"> = {
  active: "success",
  paused: "warning",
  completed: "secondary",
};

export default async function DashboardPage() {
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const data = await getDashboardData(session.user.id);
  const firstName = session.user.name?.split(" ")[0] ?? "there";

  return (
    <>
      <Topbar title="Dashboard" />
      <div className="flex-1 space-y-6 p-4 lg:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h2>
          <p className="text-sm text-muted-foreground">
            {session.user.companyName ? `${session.user.companyName} · ` : ""}
            Here&apos;s what&apos;s happening across your SEO operations today.
          </p>
        </div>

        {/* Performance cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={FolderKanban} label="Active projects" value={String(data.activeProjects)} sub={`${data.totalProjects} total`} />
          <StatCard icon={Bot} label="AI agents online" value={String(data.agentCount)} sub="Specialist agents ready" />
          <StatCard icon={Search} label="Keywords saved" value={String(data.usage.keywordsSaved)} sub="Across all research" />
          <StatCard icon={FileText} label="Content drafts" value={String(data.usage.contentDrafts)} sub="Generated so far" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* SEO Score Overview */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> SEO health score
              </CardTitle>
              <CardDescription>
                {data.latestAuditUrl ? `From your latest audit of ${truncate(data.latestAuditUrl, 34)}` : "Run your first audit to see a score"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.seoHealthScore === null ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-muted-foreground">No audits yet. Your health score is computed from your most recent audit&apos;s findings.</p>
                  <Button asChild size="sm">
                    <Link href="/seo-audit">
                      Run an audit <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-semibold tracking-tight">{data.seoHealthScore}</span>
                    <span className="mb-1 text-sm text-muted-foreground">/ 100</span>
                  </div>
                  <Progress value={data.seoHealthScore} />
                  <p className="text-xs text-muted-foreground">
                    Updated {data.latestAuditAt ? formatRelativeTime(data.latestAuditAt) : ""} · weighted from critical, warning & info findings
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Agent Status */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" /> AI agent status
              </CardTitle>
              <CardDescription>Boss Agent registry, loaded from specialist agent specs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <span className="text-sm font-medium">Registry online</span>
                <Badge variant="success">{data.agentCount} agents</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <span className="text-sm font-medium">Chat messages routed</span>
                <span className="text-sm text-muted-foreground">{data.usage.chatMessages}</span>
              </div>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href="/workspace">
                  Open AI Workspace <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Quick actions */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Quick actions
              </CardTitle>
              <CardDescription>Jump straight into common workflows</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <action.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{action.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{action.description}</span>
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Active projects */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-primary" /> Active projects
                </CardTitle>
                <CardDescription>Your most recently updated client projects</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/projects">
                  View all <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {data.projects.length === 0 ? (
                <EmptyState message="No projects yet." actionHref="/projects" actionLabel="Create your first project" />
              ) : (
                <div className="space-y-1">
                  {data.projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="flex items-center justify-between rounded-lg px-2.5 py-2.5 text-sm transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{project.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{project.domain ?? "No domain set"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-muted-foreground">{formatRelativeTime(project.updatedAt)}</span>
                        <Badge variant={statusTone[project.status] ?? "secondary"}>{project.status}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Recent activity
              </CardTitle>
              <CardDescription>What&apos;s happened lately</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentActivity.length === 0 ? (
                <EmptyState message="No activity yet. Actions across the platform will show up here." />
              ) : (
                <ul className="space-y-3">
                  {data.recentActivity.map((item) => (
                    <li key={item.id} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0">
                        <p className="truncate">{item.message}</p>
                        <p className="text-xs text-muted-foreground">{formatRelativeTime(item.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: typeof FolderKanban; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <p className="truncate text-xs text-muted-foreground">
            {label} · {sub}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message, actionHref, actionLabel }: { message: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {actionHref && actionLabel ? (
        <Button asChild size="sm" variant="outline">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : null}
    </div>
  );
}
