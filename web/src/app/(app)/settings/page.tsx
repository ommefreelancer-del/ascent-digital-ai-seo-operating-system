import { Topbar } from "@/components/layout/topbar";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { getConnectionStatus } from "@/server/google-search-console";
import { getConnectionStatus as getGoogleSheetsConnectionStatus } from "@/server/google-sheets";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const session = await getServerAuthSession();
  if (!session) redirect("/login");

  const [user, apiKeys, googleSearchConsole, googleSheets] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        companyName: true,
        jobTitle: true,
        theme: true,
        emailNotifications: true,
        productUpdates: true,
        weeklyDigest: true,
      },
    }),
    db.apiKey.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, keyPrefix: true, createdAt: true, lastUsedAt: true },
    }),
    getConnectionStatus(session.user.id),
    getGoogleSheetsConnectionStatus(session.user.id),
  ]);

  if (!user) redirect("/login");

  return (
    <>
      <Topbar title="Settings" />
      <div className="flex-1 p-4 lg:p-6">
        <SettingsShell
          user={user}
          initialApiKeys={apiKeys.map((k) => ({
            ...k,
            createdAt: k.createdAt.toISOString(),
            lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          }))}
          initialGoogleSearchConsole={googleSearchConsole}
          initialGoogleSheets={googleSheets}
        />
      </div>
    </>
  );
}
