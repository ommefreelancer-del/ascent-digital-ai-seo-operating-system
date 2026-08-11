"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Copy, ExternalLink, KeyRound, Laptop, Link2, Moon, Plus, Search, Sun, Trash2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn, formatRelativeTime } from "@/lib/utils";
import { apiKeySchema, profileSchema, urlInspectionSchema } from "@/lib/validators";

interface UserSettings {
  name: string;
  email: string;
  companyName: string | null;
  jobTitle: string | null;
  theme: string;
  emailNotifications: boolean;
  productUpdates: boolean;
  weeklyDigest: boolean;
}

interface ApiKeyItem {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function SettingsShell({
  user,
  initialApiKeys,
  initialGoogleSearchConsole,
}: {
  user: UserSettings;
  initialApiKeys: ApiKeyItem[];
  initialGoogleSearchConsole: { connected: boolean; connectedAt?: string };
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = React.useState(searchParams.get("tab") === "integrations" ? "integrations" : "profile");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="flex h-auto flex-wrap gap-1 bg-transparent p-0">
        {["profile", "company", "api-keys", "theme", "notifications", "billing", "integrations"].map((tab) => (
          <TabsTrigger key={tab} value={tab} className="capitalize data-[state=active]:bg-secondary">
            {tab.replace("-", " ")}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="profile">
        <ProfileCard user={user} field="profile" />
      </TabsContent>
      <TabsContent value="company">
        <ProfileCard user={user} field="company" />
      </TabsContent>
      <TabsContent value="api-keys">
        <ApiKeysCard initialKeys={initialApiKeys} />
      </TabsContent>
      <TabsContent value="theme">
        <ThemeCard initialTheme={user.theme} />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationsCard user={user} />
      </TabsContent>
      <TabsContent value="billing">
        <PlaceholderCard title="Billing" message="Billing and subscription management is coming soon. No payment provider is connected yet." />
      </TabsContent>
      <TabsContent value="integrations">
        <IntegrationsCard initial={initialGoogleSearchConsole} />
      </TabsContent>
    </Tabs>
  );
}

function ProfileCard({ user, field }: { user: UserSettings; field: "profile" | "company" }) {
  const [name, setName] = React.useState(user.name);
  const [jobTitle, setJobTitle] = React.useState(user.jobTitle ?? "");
  const [companyName, setCompanyName] = React.useState(user.companyName ?? "");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = profileSchema.safeParse({ name, jobTitle: jobTitle || undefined, companyName: companyName || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save your changes.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{field === "profile" ? "Profile" : "Company"}</CardTitle>
        <CardDescription>{field === "profile" ? "Your personal account details." : "The organization you work for."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${field}-email`}>Email</Label>
            <Input id={`${field}-email`} value={user.email} disabled />
          </div>
          {field === "profile" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-title">Job title</Label>
                <Input id="job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="SEO Manager" />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Company name</Label>
              <Input id="company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Ascent Digital" />
            </div>
          )}
          {error ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </p>
          ) : null}
          <Button type="submit" loading={saving} disabled={saving}>
            {saved ? (
              <>
                <Check className="h-4 w-4" /> Saved
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ThemeCard({ initialTheme }: { initialTheme: string }) {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  async function choose(value: "system" | "light" | "dark") {
    const previous = mounted ? theme : initialTheme;
    setTheme(value);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: value }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch {
      setTheme(previous ?? "system");
      toast({ title: "Couldn't save theme", description: "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const current = mounted ? theme : initialTheme;

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>Choose how ADASOS looks on this and future sessions.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
        {[
          { value: "light" as const, label: "Light", icon: Sun },
          { value: "dark" as const, label: "Dark", icon: Moon },
          { value: "system" as const, label: "System", icon: Laptop },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={current === opt.value}
            onClick={() => choose(opt.value)}
            disabled={saving}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm transition-colors",
              current === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
            )}
          >
            <opt.icon className="h-5 w-5" />
            {opt.label}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function NotificationsCard({ user }: { user: UserSettings }) {
  const { toast } = useToast();
  const [emailNotifications, setEmailNotifications] = React.useState(user.emailNotifications);
  const [productUpdates, setProductUpdates] = React.useState(user.productUpdates);
  const [weeklyDigest, setWeeklyDigest] = React.useState(user.weeklyDigest);
  const [pending, setPending] = React.useState<string | null>(null);

  async function update(key: string, value: boolean, previous: boolean, revert: (v: boolean) => void) {
    setPending(key);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch {
      revert(previous);
      toast({ title: "Couldn't save preference", description: "Please try again.", variant: "destructive" });
    } finally {
      setPending(null);
    }
  }

  const rows: Array<{ key: string; label: string; description: string; value: boolean; set: (v: boolean) => void }> = [
    { key: "emailNotifications", label: "Email notifications", description: "Important account and project activity.", value: emailNotifications, set: setEmailNotifications },
    { key: "productUpdates", label: "Product updates", description: "New features and platform announcements.", value: productUpdates, set: setProductUpdates },
    { key: "weeklyDigest", label: "Weekly digest", description: "A weekly summary of your projects and reports.", value: weeklyDigest, set: setWeeklyDigest },
  ];

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Control what ADASOS emails you about.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.description}</p>
            </div>
            <Switch
              checked={row.value}
              disabled={pending === row.key}
              onCheckedChange={(checked) => {
                const previous = row.value;
                row.set(checked);
                update(row.key, checked, previous, row.set);
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ApiKeysCard({ initialKeys }: { initialKeys: ApiKeyItem[] }) {
  const { toast } = useToast();
  const [keys, setKeys] = React.useState(initialKeys);
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = apiKeySchema.safeParse({ label });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the key.");
      setKeys((prev) => [data.key, ...prev]);
      setRevealedKey(data.rawKey);
      setLabel("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this API key? Any application using it will stop working immediately.")) return;
    const previous = keys;
    setKeys((prev) => prev.filter((k) => k.id !== id));
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Revoke failed");
    } catch {
      setKeys(previous);
      toast({ title: "Couldn't revoke key", description: "Please try again.", variant: "destructive" });
    }
  }

  function copyKey() {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      {revealedKey ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">Your new API key -- copy it now, it won&apos;t be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{revealedKey}</code>
              <Button size="sm" variant="outline" onClick={copyKey} aria-label={copied ? "Copied" : "Copy key"}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRevealedKey(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>API keys</CardTitle>
            <CardDescription>For programmatic access to your ADASOS account.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New key
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>Give it a label so you remember what it&apos;s used for.</DialogDescription>
              </DialogHeader>
              <form onSubmit={createKey} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="key-label">Label</Label>
                  <Input id="key-label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="CI pipeline" />
                </div>
                {error ? (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" /> {error}
                  </p>
                ) : null}
                <DialogFooter>
                  <Button type="submit" loading={creating} disabled={creating}>
                    Create key
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-2">
          {keys.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{k.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {k.keyPrefix}&hellip; &middot; {k.lastUsedAt ? `last used ${formatRelativeTime(k.lastUsedAt)}` : "never used"}
                    </p>
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => revoke(k.id)} aria-label="Revoke key">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationsCard({ initial }: { initial: { connected: boolean; connectedAt?: string } }) {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const notified = React.useRef(false);

  React.useEffect(() => {
    if (notified.current) return;
    const gsc = searchParams.get("gsc");
    if (!gsc) return;
    notified.current = true;
    const messages: Record<string, { title: string; variant?: "destructive" }> = {
      connected: { title: "Google Search Console connected" },
      denied: { title: "Connection cancelled", variant: "destructive" },
      invalid_state: { title: "Connection failed -- please try again", variant: "destructive" },
      error: { title: "Connection failed -- please try again", variant: "destructive" },
    };
    const message = messages[gsc];
    if (message) toast({ title: message.title, variant: message.variant });
    if (gsc === "connected") setStatus({ connected: true, connectedAt: new Date().toISOString() });
  }, [searchParams, toast]);

  async function disconnect() {
    if (!confirm("Disconnect Google Search Console? You'll need to reconnect to access Search Console data again.")) return;
    setPending(true);
    try {
      const res = await fetch("/api/integrations/google-search-console", { method: "DELETE" });
      if (!res.ok) throw new Error("Disconnect failed");
      setStatus({ connected: false });
      toast({ title: "Google Search Console disconnected" });
    } catch {
      toast({ title: "Couldn't disconnect", description: "Please try again.", variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>Connect third-party accounts ADASOS can pull data from.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
          <div>
            <p className="text-sm font-medium">Google Search Console</p>
            <p className="text-xs text-muted-foreground">
              {status.connected
                ? `Connected${status.connectedAt ? ` · ${formatRelativeTime(status.connectedAt)}` : ""}`
                : "Not connected -- read-only access to your Search Console properties."}
            </p>
          </div>
          {status.connected ? (
            <Button size="sm" variant="outline" onClick={disconnect} disabled={pending} loading={pending}>
              <Unlink className="h-3.5 w-3.5" /> Disconnect
            </Button>
          ) : (
            <Button size="sm" asChild>
              <a href="/api/integrations/google-search-console/connect">
                <Link2 className="h-3.5 w-3.5" /> Connect
              </a>
            </Button>
          )}
        </div>
        {status.connected ? <UrlInspectionTool /> : null}
        <div className="border-t border-border pt-4">
          <Badge variant="secondary" className="mb-2">
            Coming soon
          </Badge>
          <p className="text-sm text-muted-foreground">Analytics and CMS platform integrations are coming soon.</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface UrlInspectionApiResult {
  siteUrl: string;
  inspectionUrl: string;
  result: {
    inspectionResultLink: string;
    indexStatusResult?: {
      verdict: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      crawledAs?: string;
    };
  };
}

/** Verdict values come straight from Google's real urlInspection.index.inspect response (PASS/FAIL/NEUTRAL/VERDICT_UNSPECIFIED) -- never fabricated or normalized to something friendlier that could misrepresent the actual result. */
function verdictBadgeVariant(verdict: string): "success" | "destructive" | "warning" | "secondary" {
  if (verdict === "PASS") return "success";
  if (verdict === "FAIL") return "destructive";
  if (verdict === "NEUTRAL") return "warning";
  return "secondary";
}

function UrlInspectionTool() {
  const [url, setUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<UrlInspectionApiResult | null>(null);

  async function inspect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = urlInspectionSchema.safeParse({ url });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid URL.");
      return;
    }
    setLoading(true);
    setData(null);
    try {
      const res = await fetch("/api/integrations/google-search-console/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not inspect this URL.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not inspect this URL.");
    } finally {
      setLoading(false);
    }
  }

  const index = data?.result.indexStatusResult;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <p className="text-sm font-medium">URL Inspection</p>
        <p className="text-xs text-muted-foreground">Check a URL&apos;s real Google index status via Search Console.</p>
      </div>
      <form onSubmit={inspect} className="flex items-center gap-2">
        <Input
          type="url"
          required
          placeholder="https://example.com/page"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="URL to inspect"
        />
        <Button type="submit" size="sm" loading={loading} disabled={loading}>
          <Search className="h-3.5 w-3.5" /> Inspect
        </Button>
      </form>
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </p>
      ) : null}
      {index ? (
        <div className="space-y-2 rounded-lg border border-border px-3 py-3">
          <div className="flex items-center gap-2">
            <Badge variant={verdictBadgeVariant(index.verdict)}>{index.verdict}</Badge>
            {index.coverageState ? <span className="text-sm">{index.coverageState}</span> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {index.indexingState ? (
              <>
                <dt>Indexing</dt>
                <dd className="text-foreground">{index.indexingState}</dd>
              </>
            ) : null}
            {index.pageFetchState ? (
              <>
                <dt>Last fetch</dt>
                <dd className="text-foreground">{index.pageFetchState}</dd>
              </>
            ) : null}
            {index.robotsTxtState ? (
              <>
                <dt>robots.txt</dt>
                <dd className="text-foreground">{index.robotsTxtState}</dd>
              </>
            ) : null}
            {index.lastCrawlTime ? (
              <>
                <dt>Last crawled</dt>
                <dd className="text-foreground">{formatRelativeTime(index.lastCrawlTime)}</dd>
              </>
            ) : null}
          </dl>
          <a
            href={data!.result.inspectionResultLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View full report in Search Console <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}
    </div>
  );
}

function PlaceholderCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Badge variant="secondary" className="mb-2">
          Coming soon
        </Badge>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
