// The seam between "the agent needs real website operations data" and
// "where that data actually comes from". GLOBAL_RULES.md SS9 requires
// explicit human approval before "connecting external services" -- a real
// provider (WordPress, cPanel/hosting dashboard, Cloudflare, UpdraftPlus,
// Wordfence, per this agent's own spec) would be exactly that. No concrete
// provider ships in this build -- only the interface and a
// NullWebsiteManagementProvider that honestly reports "unavailable" (see
// providers/null-website-management-provider.ts). This agent never
// executes an update, backup, restore, or security action itself, in this
// build or any future one -- per GLOBAL_RULES.md's own governance model,
// "agents may prepare drafts and recommendations without approval but must
// not execute these actions unless explicitly authorized." A real provider
// wired in later would still only ever be read from (fetchWebsiteHealth),
// never commanded to mutate the live site, from this agent.

export interface WebsiteHealthRequest {
  readonly url: string;
}

export interface AvailableUpdate {
  readonly component: string;
  readonly currentVersion: string;
  readonly availableVersion: string;
  readonly isSecurityUpdate: boolean;
}

export interface BackupStatus {
  readonly lastBackupAt: string | null;
  readonly isRestorable: boolean | null;
}

export interface SecurityScanResult {
  readonly threatsFound: number;
  readonly lastScannedAt: string;
}

export interface UptimeStatus {
  readonly isUp: boolean;
  /** Real, measured uptime percentage over the provider's own reporting window. */
  readonly uptimePercentage: number;
  readonly lastCheckedAt: string;
}

export interface WebsiteHealthSnapshot {
  readonly url: string;
  readonly uptime: UptimeStatus | null;
  readonly availableUpdates: readonly AvailableUpdate[];
  readonly backupStatus: BackupStatus | null;
  readonly securityScan: SecurityScanResult | null;
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface WebsiteManagementProvider {
  readonly name: string;
  /**
   * Resolves to the real website health snapshot for `request.url`, or
   * `null` if no data is available (no provider configured, url not
   * recognized, etc). Implementations must never invent a value here --
   * `null` is always the correct response when genuine data cannot be
   * obtained. Read-only: this method must never mutate the live site.
   */
  fetchWebsiteHealth(request: WebsiteHealthRequest): Promise<WebsiteHealthSnapshot | null>;
}
