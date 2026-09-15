// Real GitHub REST API client + the first real RemediationExecutionAdapter
// (see src/boss-agent/remediation/remediation-execution-bridge.ts). Lives in
// web/server (not the frozen backend) because it needs Prisma/env access --
// the exact same architectural placement as server/wordpress.ts and
// server/google-search-console.ts.
//
// AUTH MODEL (this task's own Section 4: "Prefer OAuth / GitHub App /
// installation-based authorization... over raw long-lived personal access
// tokens"): implemented as a standard GitHub OAuth App (like
// WordPress.com's OAuth2 connection already in this codebase --
// server/wordpress-com-oauth.ts is the pattern this mirrors), not a full
// GitHub App with an installation flow. A GitHub App is the *more*
// least-privilege option long-term (installation-scoped to specific repos
// with fine-grained permissions, short-lived installation tokens) but
// requires registering and configuring a GitHub App manifest -- meaningfully
// more setup than this milestone's scope. OAuth App tokens are user-scoped
// (broader than ideal) but this connection enforces its OWN least-privilege
// boundary in code: `repositoryFullName` pins every operation to exactly one
// repository regardless of what the underlying token could technically
// reach (see GitHubConnection's own schema comment, and
// GitHubRepositoryAdapter.validateAccess()). Upgrading to a real GitHub App
// later is a drop-in replacement behind this same adapter interface.
//
// REAL-WORLD FINDING (2026-08-14, verified against the actual acceptance-test
// repository): a real, unauthenticated GET to
// api.github.com/repos/ommefreelancer-del/portfolio-website/contents/robots.txt
// shows a robots.txt DOES exist in the repo's default branch root -- but the
// LIVE site (ommefreelancer-del.github.io/portfolio-website/robots.txt)
// genuinely 404s. This means GitHub Pages is very likely serving from a
// DIFFERENT branch/path than the default branch root (a common real-world
// static-site-generator footgun: the source repo and the deployed output
// aren't the same tree). This is exactly why Section 3's "inspect the actual
// repository/deployment configuration before executing deployment" matters
// in practice, not just in principle -- getPagesConfiguration() below is a
// real API call, never an assumption, and every write targets the Pages
// config's own real source branch/path, not a guessed "master:robots.txt".

import { db } from "@/server/db";
import { encryptSecret, decryptSecret, isCredentialEncryptionConfigured } from "@/server/credential-encryption";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
// Least-privilege scope for this milestone: read/write repository contents
// only -- never `repo` (full control including admin/deletion) or any
// organization-wide scope. See this task's own Section 7.
const REQUIRED_SCOPE = "public_repo";

// Section 9/17: the ONLY origin-relative URL paths this adapter will ever
// write to, and the ONLY two remediation types this system implements
// (2026-08-14: robots.txt, plus the homepage's canonical <link> tag --
// "at least one real end-to-end controllable remediation" requirement).
// Refuses everything else outright -- "protection against arbitrary
// repository commands" is enforced here, not merely documented. Keyed by
// origin-relative URL PATH (trailing "/" resolved to "index.html", the
// standard static-site convention), NOT by the real repository file path --
// see execute()'s own comment on why those two are computed separately (a
// GitHub Pages PROJECT site's URL path includes a repo-name prefix that is
// never part of the repository's own file tree).
//
// GITHUB PAGES CAPABILITY REGISTRY (2026-08-15, origin-root remediation
// pass): the homepage's own origin-relative path is NOT a fixed literal --
// it depends on the CONNECTED repository's real Pages topology, which
// GitHub itself defines structurally from the repository's own name (never
// guessed, never a live call): a repository named exactly
// "{accountLogin}.github.io" deploys to the account's origin root
// (USER_SITE_ROOT / ORG_SITE_ROOT); every other repository name deploys
// under "/{repo-name}/" (PROJECT_SITE_PATH). robots.txt is always
// origin-relative "robots.txt" regardless of topology -- see
// classifyPagesSiteTopology()'s own header for the full registry this
// replaces the old single hardcoded "portfolio-website/index.html" string
// with. "Do NOT hardcode one repository name" (this task's own rule) --
// this generalizes canonical-URL remediation to ANY connected project-site
// OR user/org-site repository, not just the one this system happened to be
// built and tested against first.
type RemediationOperation = "replace_file" | "set_canonical_link";
const REMEDIATION_OPERATIONS: ReadonlyMap<string, RemediationOperation> = new Map([
  ["robots.txt", "replace_file"],
  ["index.html", "set_canonical_link"],
  // SITEMAP REMEDIATION CAPABILITY (2026-08-22): a freshly-generated
  // sitemap.xml is always a full-file replace (like robots.txt), never a
  // targeted in-place edit of existing content -- see
  // sitemap-remediation-planner.ts's own header.
  ["sitemap.xml", "replace_file"],
]);

/**
 * GitHub Pages capability registry (this task's own Section 6):
 *   - PROJECT_SITE_ROOT: the project-site repository's OWN file-tree root
 *     (what the repository actually contains) -- distinct from...
 *   - PROJECT_SITE_PATH: the URL path segment a project site is served
 *     under ("/{repo-name}/") -- a URL-ROUTING artifact only, never part of
 *     the repository's own file tree (see execute()'s own comment).
 *   - USER_SITE_ROOT / ORG_SITE_ROOT: a repository named exactly
 *     "{accountLogin}.github.io" -- its file-tree root IS the account's
 *     real origin root; no path segment, no prefix.
 * "project_site" vs "user_org_site" below is the two-way distinction
 * everything else in this module (validateScope, isEligibleForTask,
 * checkUserOrgPagesRepositoryAvailability) is actually built on -- the
 * finer PROJECT_SITE_ROOT/PROJECT_SITE_PATH split exists as a naming
 * concept for documentation/registry purposes; the real, live-verified
 * distinction that governs eligibility is always resourceIsCoveredByLiveUrl()
 * against the repository's OWN real, fetched Pages liveUrl -- topology
 * classification here only derives the coarse, pre-network SCOPE allowlist
 * (validateScope()), never the final eligibility answer.
 */
export type PagesSiteTopology = "project_site" | "user_org_site";

/**
 * Real, structural GitHub Pages convention -- not a guess, not a live call:
 * GitHub deploys a repository named exactly "{accountLogin}.github.io" to
 * the account's own origin root; every other repository name deploys under
 * "/{repo-name}/" when Pages is enabled for it. Case-insensitive (GitHub
 * repository/login names are case-insensitive). This is the FIRST, coarse
 * classification used to build the pre-network scope allowlist below --
 * the real, authoritative "does this deployment actually serve this
 * resource" answer always comes from the live-fetched Pages configuration
 * (resourceIsCoveredByLiveUrl against pages.liveUrl), which also correctly
 * handles a project site or user/org site served from a custom domain.
 */
export function classifyPagesSiteTopology(repositoryFullName: string, accountLogin: string): PagesSiteTopology {
  const repoName = repositoryFullName.split("/")[1] ?? "";
  return repoName.toLowerCase() === `${accountLogin.toLowerCase()}.github.io` ? "user_org_site" : "project_site";
}

/**
 * The real, structural project-site URL path segment -- "{repo-name}/" --
 * derived from the repository's own name, per GitHub's own Pages
 * convention (classifyPagesSiteTopology()'s own header). `null` for a
 * user/org site (no path segment -- the repository's root IS the URL
 * root).
 */
function projectSitePathSegment(repositoryFullName: string, accountLogin: string): string | null {
  if (classifyPagesSiteTopology(repositoryFullName, accountLogin) === "user_org_site") {
    return null;
  }
  return repositoryFullName.split("/")[1] ?? null;
}

/**
 * REPOSITORY-TARGET RESOLUTION FIX (2026-08-19): the real, structural
 * (never live-fetched) GitHub Pages URL a connected repository would deploy
 * to, per the same convention classifyPagesSiteTopology()/
 * projectSitePathSegment() already encode -- "{accountLogin}.github.io" for
 * a user/org-site repository, "{accountLogin}.github.io/{repo-name}/" for a
 * project-site repository. Used by api/workspace/messages/route.ts to make
 * the currently connected repository the authoritative audit target instead
 * of silently falling back to whatever site was most recently audited (see
 * that file's own header comment on this fix). Deliberately does not verify
 * the URL is actually live -- if the connected repository has no real
 * deployment, the real audit attempt against this URL will honestly fail
 * with a real fetch error rather than this function fabricating success or
 * silently substituting a different site.
 */
export function deriveConnectedRepositoryLiveUrl(accountLogin: string, repositoryFullName: string): string {
  const pathSegment = projectSitePathSegment(repositoryFullName, accountLogin);
  return pathSegment ? `https://${accountLogin.toLowerCase()}.github.io/${pathSegment}/` : `https://${accountLogin.toLowerCase()}.github.io/`;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

interface GitHubConnectionRecord {
  readonly id: string;
  readonly userId: string;
  readonly accountLogin: string;
  readonly repositoryFullName: string;
  readonly scope: string;
  readonly status: string;
}

/** Real, decrypted lookup -- the ONLY function in this module that ever holds a plaintext token for use against the remediation execution adapter, and only for the duration of the request that needs it. Scoped strictly to `userId` -- there is no code path here that can fetch another user's connection. Requires "active" status AND a chosen repository -- a connection still awaiting repository selection (see selectGitHubRepository()) is never eligible here. */
async function getDecryptedConnection(userId: string): Promise<{ record: GitHubConnectionRecord; accessToken: string } | null> {
  const record = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!record || record.status !== "active" || !record.repositoryFullName) {
    return null;
  }
  const accessToken = decryptSecret(record.encryptedAccessToken);
  return { record: { ...record, repositoryFullName: record.repositoryFullName }, accessToken };
}

/** Real, decrypted lookup used by the repository-selection flow (listAuthorizedRepositories()/selectGitHubRepository()) -- unlike getDecryptedConnection(), this allows "pending_repository_selection" (no repository chosen yet) since that's exactly the state this flow exists to resolve. Still refuses "revoked"/"invalid". */
async function getDecryptedConnectionForSelection(userId: string): Promise<{ accountLogin: string; scope: string; repositoryFullName: string | null; accessToken: string }> {
  const record = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!record || record.status === "revoked" || record.status === "invalid") {
    throw new Error("No GitHub connection to select a repository for. Connect GitHub first.");
  }
  return { accountLogin: record.accountLogin, scope: record.scope, repositoryFullName: record.repositoryFullName, accessToken: decryptSecret(record.encryptedAccessToken) };
}

async function fetchLiveAuthorizedRepositories(accessToken: string): Promise<readonly string[]> {
  const { data: repos } = await githubRequest<Array<{ full_name: string; permissions?: { push?: boolean } }>>(accessToken, "GET", "/user/repos?per_page=100&affiliation=owner");
  return (repos ?? []).filter((r) => r.permissions?.push).map((r) => r.full_name);
}

/**
 * `accessToken` may be an empty string for a deliberately unauthenticated
 * request against a public resource (e.g. inspecting a public repository's
 * Pages configuration or reading a public file before any connection
 * exists) -- GitHub's API treats a genuinely missing Authorization header
 * as "unauthenticated", which is different from (and works correctly,
 * unlike) sending a malformed "Bearer " with no token.
 */
async function githubRequest<T>(accessToken: string, method: string, endpoint: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "user-agent": "ADASOS-Remediation/1.0",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404) {
    return { status: 404, data: null };
  }
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : null;
  if (!response.ok) {
    const message = (data as { message?: string } | null)?.message ?? `GitHub API request failed with HTTP ${response.status}.`;
    throw new GitHubApiError(message, response.status, endpoint);
  }
  return { status: response.status, data };
}

// ============================================================
// OAuth connection flow -- mirrors server/wordpress-com-oauth.ts's own
// build-URL / exchange-code shape.
// ============================================================

export function buildGitHubConnectUrl(redirectUri: string, state: string): string {
  const url = new URL(GITHUB_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", REQUIRED_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface GitHubConnectResult {
  readonly accountLogin: string;
  readonly availableRepositories: readonly string[];
}

/** Exchanges a real OAuth code for a real access token, fetches the real authenticated user + their real accessible repositories -- never saves a connection yet (no repositoryFullName chosen until the caller picks one -- see saveGitHubRepositorySelection()). */
export async function exchangeGitHubCode(code: string, redirectUri: string): Promise<{ accessToken: string; result: GitHubConnectResult }> {
  const tokenResponse = await fetch(GITHUB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenJson = (await tokenResponse.json()) as { access_token?: string; error?: string; error_description?: string; scope?: string };
  if (!tokenResponse.ok || !tokenJson.access_token) {
    throw new GitHubApiError(tokenJson.error_description ?? tokenJson.error ?? "GitHub did not return an access token.", tokenResponse.status, "/login/oauth/access_token");
  }
  const accessToken = tokenJson.access_token;

  const { data: user } = await githubRequest<{ login: string }>(accessToken, "GET", "/user");
  if (!user) {
    throw new GitHubApiError("GitHub did not return the authenticated user.", null, "/user");
  }
  const availableRepositories = await fetchLiveAuthorizedRepositories(accessToken);

  return { accessToken, result: { accountLogin: user.login, availableRepositories } };
}

/** Persists the real connection -- encrypted token, single authorized repository (least privilege), real granted scope. Used both by the GITHUB_TARGET_REPOSITORY dev/bootstrap fast path and by selectGitHubRepository() (the normal production onboarding path). */
export async function saveGitHubRepositorySelection(userId: string, accessToken: string, accountLogin: string, repositoryFullName: string, grantedScope: string): Promise<void> {
  if (!isCredentialEncryptionConfigured()) {
    throw new Error("Cannot save a GitHub connection: CREDENTIAL_ENCRYPTION_KEY is not configured on this server.");
  }
  await db.gitHubConnection.upsert({
    where: { userId },
    create: { userId, accountLogin, repositoryFullName, encryptedAccessToken: encryptSecret(accessToken), scope: grantedScope, status: "active" },
    update: { accountLogin, repositoryFullName, encryptedAccessToken: encryptSecret(accessToken), scope: grantedScope, status: "active" },
  });
}

/**
 * PRODUCTION HARDENING (2026-08-15), Section 4: persists the real,
 * confirmed OAuth token immediately after GitHub authorizes the account,
 * with NO repository chosen yet -- this is what lets normal onboarding
 * happen without a global GITHUB_TARGET_REPOSITORY env var + restart. The
 * connection sits at "pending_repository_selection" (never eligible for
 * remediation execution -- see getDecryptedConnection()'s own status
 * check) until listAuthorizedRepositories()/selectGitHubRepository() below
 * complete it.
 */
export async function savePendingGitHubConnection(userId: string, accessToken: string, accountLogin: string, grantedScope: string): Promise<void> {
  if (!isCredentialEncryptionConfigured()) {
    throw new Error("Cannot save a GitHub connection: CREDENTIAL_ENCRYPTION_KEY is not configured on this server.");
  }
  await db.gitHubConnection.upsert({
    where: { userId },
    create: { userId, accountLogin, repositoryFullName: null, encryptedAccessToken: encryptSecret(accessToken), scope: grantedScope, status: "pending_repository_selection" },
    update: { accountLogin, repositoryFullName: null, encryptedAccessToken: encryptSecret(accessToken), scope: grantedScope, status: "pending_repository_selection" },
  });
}

/** One selectable repository, labeled with its real GitHub Pages topology (this task's own Section 3: "add support for selecting the repository that controls the origin root") -- classifyPagesSiteTopology() is pure metadata-derived, no extra network call per repository. */
export interface GitHubRepositoryOption {
  readonly fullName: string;
  readonly topology: PagesSiteTopology;
}

export interface GitHubRepositoryOptions {
  readonly accountLogin: string;
  readonly availableRepositories: readonly GitHubRepositoryOption[];
  readonly currentRepositoryFullName: string | null;
}

/** Real, LIVE (never cached/stale) list of repositories this workspace's connected GitHub account currently has push access to -- used both to populate the initial repository picker and to let an already-connected workspace switch repositories. Requires an existing connection (any status except revoked/invalid); throws a clear error otherwise rather than silently returning an empty list. */
export async function listAuthorizedRepositories(userId: string): Promise<GitHubRepositoryOptions> {
  const connection = await getDecryptedConnectionForSelection(userId);
  const fullNames = await fetchLiveAuthorizedRepositories(connection.accessToken);
  const availableRepositories = fullNames.map((fullName) => ({ fullName, topology: classifyPagesSiteTopology(fullName, connection.accountLogin) }));
  return { accountLogin: connection.accountLogin, availableRepositories, currentRepositoryFullName: connection.repositoryFullName };
}

/**
 * PRODUCTION HARDENING (2026-08-15), Section 4: completes onboarding (from
 * "pending_repository_selection") OR switches an already-active
 * connection's authorized repository. Re-validates live, immediately before
 * saving, that the account still genuinely has push access to the
 * requested repository (never trusts a client-supplied name against a
 * stale/cached list) -- "only authorized repos selectable" and "revalidate
 * ownership/scope before save" from this task's own requirements.
 */
export async function selectGitHubRepository(userId: string, repositoryFullName: string): Promise<GitHubConnectionStatus> {
  const connection = await getDecryptedConnectionForSelection(userId);
  const availableRepositories = await fetchLiveAuthorizedRepositories(connection.accessToken);
  if (!availableRepositories.includes(repositoryFullName)) {
    throw new Error(`This GitHub account does not currently have push access to "${repositoryFullName}".`);
  }
  await saveGitHubRepositorySelection(userId, connection.accessToken, connection.accountLogin, repositoryFullName, connection.scope);
  return { connected: true, accountLogin: connection.accountLogin, repositoryFullName, connectedAt: new Date().toISOString() };
}

/** Revocation support (Section 4) -- marks the connection revoked; never deletes the audit trail of its past use. */
export async function revokeGitHubConnection(userId: string): Promise<void> {
  await db.gitHubConnection.updateMany({ where: { userId }, data: { status: "revoked" } });
}

export interface GitHubConnectionStatus {
  readonly connected: boolean;
  readonly accountLogin?: string;
  readonly repositoryFullName?: string;
  readonly connectedAt?: string;
  /** True while a real, confirmed OAuth token is stored but no repository has been chosen yet (see savePendingGitHubConnection()) -- the Settings UI shows the repository picker in this state. */
  readonly needsRepositorySelection?: boolean;
}

/** Real, non-secret connection status for the Settings UI -- mirrors getConnectionStatus() in server/wordpress.ts and server/google-sheets.ts. Never returns the encrypted token, scope internals, or any other secret. */
export async function getConnectionStatus(userId: string): Promise<GitHubConnectionStatus> {
  const connection = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!connection || connection.status === "revoked" || connection.status === "invalid") {
    return { connected: false };
  }
  if (!connection.repositoryFullName || connection.status === "pending_repository_selection") {
    return { connected: false, accountLogin: connection.accountLogin, needsRepositorySelection: true };
  }
  return {
    connected: true,
    accountLogin: connection.accountLogin,
    repositoryFullName: connection.repositoryFullName,
    connectedAt: connection.updatedAt.toISOString(),
  };
}

// ============================================================
// Real repository operations
// ============================================================

export interface PagesConfiguration {
  readonly enabled: boolean;
  readonly buildType: "legacy" | "workflow" | null;
  readonly sourceBranch: string | null;
  readonly sourcePath: string | null;
  readonly liveUrl: string | null;
}

/** Real GET of the repository's actual GitHub Pages configuration -- never assumed. A 404 here means Pages is not configured via the API ADASOS can see (enabled: false), not "assume master root". */
export async function getPagesConfiguration(accessToken: string, repositoryFullName: string): Promise<PagesConfiguration> {
  const { status, data } = await githubRequest<{ build_type: "legacy" | "workflow"; source: { branch: string; path: string }; html_url: string }>(
    accessToken,
    "GET",
    `/repos/${repositoryFullName}/pages`,
  );
  if (status === 404 || !data) {
    return { enabled: false, buildType: null, sourceBranch: null, sourcePath: null, liveUrl: null };
  }
  return {
    enabled: true,
    buildType: data.build_type,
    sourceBranch: data.source.branch,
    sourcePath: data.source.path === "/" ? "" : data.source.path.replace(/^\//, ""),
    liveUrl: data.html_url,
  };
}

export interface FileState {
  readonly exists: boolean;
  readonly sha: string | null;
  readonly content: string | null;
}

/** Real read of a file's current content + blob sha (needed for both the update PUT and rollback) at a specific branch. */
export async function readRepositoryFile(accessToken: string, repositoryFullName: string, path: string, branch: string): Promise<FileState> {
  const { status, data } = await githubRequest<{ sha: string; content: string; encoding: string }>(
    accessToken,
    "GET",
    `/repos/${repositoryFullName}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
  );
  if (status === 404 || !data) {
    return { exists: false, sha: null, content: null };
  }
  const content = data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf8") : data.content;
  return { exists: true, sha: data.sha, content };
}

export interface RepositoryTreeEntry {
  readonly path: string;
  readonly type: "blob" | "tree";
}

/**
 * WEB DEVELOPMENT AGENT GITHUB-ACCESS FIX: real, generic repository-structure
 * inspection -- a plain wrapper around GitHub's own recursive git-trees API,
 * added because until now this module could read/write ONE already-known
 * file path (readRepositoryFile/commitFile) but had no way to discover what
 * files a connected repository actually contains. Never assumes a file
 * layout (e.g. "index.html at the root") -- callers use this to find the
 * real, current website files before proposing any change. Read-only, no
 * write capability; reuses the exact same authenticated request helper every
 * other function in this module uses.
 */
export async function listRepositoryTree(accessToken: string, repositoryFullName: string, branch: string): Promise<readonly RepositoryTreeEntry[]> {
  const { status, data } = await githubRequest<{ tree: Array<{ path: string; type: string }>; truncated: boolean }>(
    accessToken,
    "GET",
    `/repos/${repositoryFullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (status === 404 || !data) {
    return [];
  }
  return data.tree
    .filter((entry): entry is { path: string; type: "blob" | "tree" } => entry.type === "blob" || entry.type === "tree")
    .map((entry) => ({ path: entry.path, type: entry.type }));
}

export interface CommitResult {
  readonly commitSha: string;
  readonly newFileSha: string;
}

/** Real commit via the Contents API -- a single atomic write, GitHub's own native "safe change" primitive (this task's own Section 3: "branch/worktree or equivalent safe change preparation"). Requires the previous file's real sha when updating an existing file (GitHub rejects a mismatched/missing sha, which is itself a real optimistic-concurrency safety check against a stale read). */
export async function commitFile(accessToken: string, repositoryFullName: string, path: string, branch: string, content: string, message: string, previousSha: string | null): Promise<CommitResult> {
  const { data } = await githubRequest<{ commit: { sha: string }; content: { sha: string } }>(accessToken, "PUT", `/repos/${repositoryFullName}/contents/${encodeURIComponent(path)}`, {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...(previousSha ? { sha: previousSha } : {}),
  });
  if (!data) {
    throw new GitHubApiError("GitHub did not return a commit result for the file write.", null, `/repos/${repositoryFullName}/contents/${path}`);
  }
  return { commitSha: data.commit.sha, newFileSha: data.content.sha };
}

export interface DeploymentStatus {
  readonly status: "building" | "built" | "errored" | "unknown";
  readonly reference: string | null;
}

/** Real check of GitHub Pages' own build status for the latest commit -- never assumed complete just because commitFile() succeeded (a commit and a deployed build are different events). */
export async function getDeploymentStatus(accessToken: string, repositoryFullName: string): Promise<DeploymentStatus> {
  const { status, data } = await githubRequest<{ status: "built" | "building" | "errored"; commit: string }>(accessToken, "GET", `/repos/${repositoryFullName}/pages/builds/latest`);
  if (status === 404 || !data) {
    return { status: "unknown", reference: null };
  }
  return { status: data.status, reference: data.commit };
}

/** Real, GitHub-native rollback: restores the file to its captured pre-change content+sha via another real commit -- never a fabricated "rolled back" claim without a real API call. Only valid when the file already existed before the remediation change (an update, not a create) -- see deleteFile() for the create case. */
export async function rollbackFile(accessToken: string, repositoryFullName: string, path: string, branch: string, previousContent: string, previousSha: string): Promise<CommitResult> {
  return commitFile(accessToken, repositoryFullName, path, branch, previousContent, `Revert ADASOS remediation change to ${path}`, previousSha);
}

/** Real deletion via the Contents API -- the correct rollback primitive when a remediation ADDED a file that genuinely did not exist before (rollbackFile()/commitFile() only ever PUT content, so they can restore a PREVIOUS version but can't undo a create back to "did not exist"). `sha` must be the file's current real sha (the same optimistic-concurrency check commitFile() uses). */
export async function deleteFile(accessToken: string, repositoryFullName: string, path: string, branch: string, sha: string, message: string): Promise<{ commitSha: string }> {
  const { data } = await githubRequest<{ commit: { sha: string } }>(accessToken, "DELETE", `/repos/${repositoryFullName}/contents/${encodeURIComponent(path)}`, {
    message,
    sha,
    branch,
  });
  if (!data) {
    throw new GitHubApiError("GitHub did not return a commit result for the file deletion.", null, `/repos/${repositoryFullName}/contents/${path}`);
  }
  return { commitSha: data.commit.sha };
}

/** Real, introspected capability list from the connection's OWN granted scope -- never a hard-coded assumption of what the token can do. */
export function describeCapabilities(scope: string, repositoryFullName: string): readonly string[] {
  const scopes = scope.split(",").map((s) => s.trim());
  const capabilities: string[] = [];
  if (scopes.includes("public_repo") || scopes.includes("repo")) {
    capabilities.push(`read/write repository contents for ${repositoryFullName}`);
  }
  return capabilities;
}

// ============================================================
// The real RemediationExecutionAdapter (see
// src/boss-agent/remediation/remediation-execution-bridge.ts's
// RemediationExecutionAdapter interface -- this class satisfies it
// structurally without importing across the dist/ boundary).
// ============================================================

export interface RemediationRollbackDataLike {
  readonly path: string;
  readonly branch: string;
  readonly previousContent: string | null;
  readonly previousSha: string | null;
}

export interface RemediationTaskLike {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly affectedResource: string;
  readonly proposedAction: string;
  /** Present only once a real EXECUTE has actually committed a change -- see execute()'s own capture and rollback()'s own use of it. */
  readonly rollbackData?: RemediationRollbackDataLike | null;
}

export interface AdapterExecutionOutcome {
  readonly success: boolean;
  readonly detail: string;
  /** Real, captured pre-change state -- only present when success:true. Lets a later, genuinely terminal verification failure trigger a real, safe rollback (see rollback() below). */
  readonly rollbackData?: RemediationRollbackDataLike;
}

export const GITHUB_REPOSITORY_CAPABILITY = "technical-remediation";
export const GITHUB_REPOSITORY_TOOL = "repository-file-write-and-deploy";

export interface ResourceCoverageResult {
  readonly covered: boolean;
  /** Empty when covered:true. Real, specific detail otherwise -- never generic. */
  readonly detail: string;
}

/**
 * Generic, remediation-type-agnostic structural check: is `affectedResource`
 * actually served by `liveUrl` (a real GitHub Pages deployment's own,
 * verified live URL)? This is the real, reusable fact behind ALL FOUR
 * preflight requirements this task's own Section 2 lists -- "controlled by
 * the connected repository", "adapter can modify", "deployment can affect",
 * "verification can target" are all the SAME real question for a static
 * site: does this deployment actually serve this path? Not hardcoded to
 * robots.txt or any other file -- pure URL/prefix comparison, so it applies
 * to any future remediation type's affected resource.
 *
 * REAL-WORLD MOTIVATION (2026-08-14): a GitHub Pages PROJECT site
 * (accountLogin.github.io/repo-name/) only ever serves paths under
 * repo-name/ -- it structurally cannot serve accountLogin.github.io/robots.txt
 * (the origin root), no matter what branch/path is targeted within the repo.
 * A naive "does the file exist in the repo" check would miss this entirely;
 * this compares against the real, live-verified deployment URL instead.
 */
export function resourceIsCoveredByLiveUrl(affectedResource: string, liveUrl: string): ResourceCoverageResult {
  let affected: URL;
  let live: URL;
  try {
    affected = new URL(affectedResource);
  } catch {
    return { covered: false, detail: `"${affectedResource}" is not a valid URL.` };
  }
  try {
    live = new URL(liveUrl);
  } catch {
    return { covered: false, detail: `the deployment's own live URL ("${liveUrl}") is not a valid URL.` };
  }
  if (affected.origin !== live.origin) {
    return { covered: false, detail: `the deployment serves a different origin ("${live.origin}") than the affected resource ("${affected.origin}").` };
  }
  const livePathPrefix = live.pathname.endsWith("/") ? live.pathname : `${live.pathname}/`;
  if (!affected.pathname.startsWith(livePathPrefix)) {
    return { covered: false, detail: `this deployment only serves paths under "${livePathPrefix}" -- "${affected.pathname}" is outside that prefix.` };
  }
  return { covered: true, detail: "" };
}

/**
 * ORIGIN-ROOT CAPABILITY (2026-08-15): only meaningful to call when the
 * CURRENTLY connected repository's real deployment does not cover
 * `affectedResource` (resourceIsCoveredByLiveUrl() already returned
 * covered:false) -- makes ONE additional real, live check for the specific
 * case that matters here (an origin-root resource on THIS SAME account),
 * and returns an honest, actionable addendum to the NOT_REMEDIABLE reason.
 * Never fabricates that a root-site repository exists or is authorized --
 * every branch below is backed by a real API call or a real, already-known
 * fact. Returns "" (no addendum) when `affectedResource` isn't even on this
 * account's Pages origin, so an unrelated mismatch is never given a
 * misleading "connect a root-site repo" suggestion. A standalone, exported
 * function (not a class method) so it's directly testable without needing
 * to first pass GitHubRepositoryAdapter.validateAccess() -- `accessToken`
 * may be "" for a deliberately unauthenticated existence-only check (same
 * convention githubRequest() itself already documents).
 */
export async function describeOriginRootAlternative(affectedResource: string, accountLogin: string, accessToken: string, currentRepositoryFullName: string): Promise<string> {
  let affected: URL;
  try {
    affected = new URL(affectedResource);
  } catch {
    return "";
  }
  if (affected.origin.toLowerCase() !== `https://${accountLogin.toLowerCase()}.github.io`) {
    return ""; // Not this account's Pages origin at all -- no relevant alternative to suggest.
  }
  const rootRepoFullName = `${accountLogin}/${accountLogin}.github.io`;
  if (currentRepositoryFullName.toLowerCase() === rootRepoFullName.toLowerCase()) {
    return ""; // Already the root-site repo -- the real mismatch is something else (e.g. Pages misconfigured), not a "wrong repository" case.
  }

  const { status, data } = await githubRequest<{ full_name: string; permissions?: { push?: boolean } }>(accessToken, "GET", `/repos/${rootRepoFullName}`);
  if (status === 404 || !data) {
    return ` A user/organization Pages site repository ("${rootRepoFullName}") is required to remediate this origin-root resource, and does not currently exist for this GitHub account.`;
  }
  if (!data.permissions?.push) {
    return ` A user/organization Pages site repository ("${rootRepoFullName}") exists, but this connection does not have push access to it -- reconnect with an account/token authorized for it to remediate this origin-root resource.`;
  }
  return ` A user/organization Pages site repository ("${rootRepoFullName}") is available and authorized for this account -- switch the connected repository to it in Settings to remediate this origin-root resource.`;
}

/**
 * ROOT-SITE PROVISIONING CAPABILITY (2026-08-16): the real, missing
 * remediation this task exists to add. Until now, describeOriginRootAlternative()
 * only ever turned a missing "{accountLogin}.github.io" repository into a
 * text ADDENDUM on a permanent NOT_REMEDIABLE outcome -- honest, but a dead
 * end (this task's own "diagnose -> NOT_REMEDIABLE -> stop" problem
 * statement). This is the same real, live "does the root-site repo exist"
 * fact, but surfaced as a structured, actionable PLAN instead of a string,
 * for the one specific, narrow case this capability covers: a same-account
 * origin-root resource whose required root-site repository genuinely does
 * not exist yet. Every other case (root-site repo exists without push
 * access, or exists and is switchable) is UNCHANGED -- still routed through
 * describeOriginRootAlternative()'s existing NOT_REMEDIABLE addendum, never
 * duplicated or weakened here.
 */
export interface RootSiteProvisioningPlan {
  readonly accountLogin: string;
  readonly connectionId: string;
  readonly currentRepositoryFullName: string;
  readonly affectedResource: string;
  /** "{accountLogin}.github.io" -- the repository this plan would create. Never hardcoded to one account; always derived from the authenticated connection's own real accountLogin. */
  readonly repositoryToCreate: string;
  readonly targetLiveUrl: string;
  readonly reasonCurrentRepoCannotControl: string;
  readonly pagesConfigurationRequired: string;
  readonly fileToWrite: string;
  readonly fileContent: string;
  readonly verificationUrl: string;
  readonly executionRisk: string;
}

/**
 * Real, live check for the ONE specific condition Section 1 defines: same-
 * account origin-root resource AND the required root-site repo genuinely
 * does not exist (a real, unauthenticated-or-authenticated GET 404 -- never
 * inferred). Returns `null` for every other case (different origin, already
 * the root repo, or the root repo already exists in ANY form) -- those stay
 * on the existing describeOriginRootAlternative() NOT_REMEDIABLE path,
 * completely unchanged.
 */
export async function checkRootSiteProvisioningPlan(
  affectedResource: string,
  accountLogin: string,
  accessToken: string,
  currentRepositoryFullName: string,
  connectionId: string,
): Promise<RootSiteProvisioningPlan | null> {
  let affected: URL;
  try {
    affected = new URL(affectedResource);
  } catch {
    return null;
  }
  if (affected.origin.toLowerCase() !== `https://${accountLogin.toLowerCase()}.github.io`) {
    return null;
  }
  const repositoryToCreate = `${accountLogin}/${accountLogin}.github.io`;
  if (currentRepositoryFullName.toLowerCase() === repositoryToCreate.toLowerCase()) {
    return null;
  }

  const { status } = await githubRequest<{ full_name: string }>(accessToken, "GET", `/repos/${repositoryToCreate}`);
  if (status !== 404) {
    return null; // Exists (with or without push access) -- not a provisioning candidate; describeOriginRootAlternative() already covers this.
  }

  return {
    accountLogin,
    connectionId,
    currentRepositoryFullName,
    affectedResource,
    repositoryToCreate,
    targetLiveUrl: `https://${accountLogin.toLowerCase()}.github.io/`,
    reasonCurrentRepoCannotControl: `"${currentRepositoryFullName}" is a GitHub Pages PROJECT-site repository -- it only ever deploys under "/${currentRepositoryFullName.split("/")[1] ?? ""}/", and structurally cannot serve or control the account's origin root ("${affected.origin}/"), regardless of which branch or path within it is targeted.`,
    pagesConfigurationRequired: `Enable GitHub Pages on the new repository, sourced from its default branch, path "/" (the account-root convention for a "{accountLogin}.github.io" repository).`,
    fileToWrite: "robots.txt",
    fileContent: "User-agent: *\nAllow: /\n",
    verificationUrl: affectedResource,
    executionRisk: `Creates a new, real, public GitHub repository ("${repositoryToCreate}") owned by this account, enables GitHub Pages on it, and commits one file to its root. This repository does not currently exist -- nothing pre-existing is modified or replaced. If live verification does not confirm the fix, the newly created repository and its Pages configuration are left in place (never automatically deleted) and the failure is recorded for manual review.`,
  };
}

export interface RepositoryCreationResult {
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly alreadyExisted: boolean;
}

/**
 * Section 3: real repository creation, with a real pre-existence check
 * first ("if it already exists, do NOT create another") -- idempotent by
 * construction, not by a separate duplicate-prevention flag. Creates under
 * the AUTHENTICATED account only (POST /user/repos has no org/owner
 * parameter to spoof) -- `accountLogin` is passed in purely for naming/
 * logging, never used to target a different account. Any real GitHub API
 * failure (permission, rate limit, naming conflict) propagates as a real
 * GitHubApiError -- never swallowed, never turned into a fabricated
 * success.
 */
export async function createRootSiteRepository(accessToken: string, accountLogin: string): Promise<RepositoryCreationResult> {
  const repoName = `${accountLogin}.github.io`;
  const { status, data: existing } = await githubRequest<{ full_name: string; default_branch: string }>(accessToken, "GET", `/repos/${accountLogin}/${repoName}`);
  if (status === 200 && existing) {
    return { fullName: existing.full_name, defaultBranch: existing.default_branch, alreadyExisted: true };
  }

  const { data } = await githubRequest<{ full_name: string; default_branch: string }>(accessToken, "POST", "/user/repos", {
    name: repoName,
    description: "User/organization GitHub Pages site -- created by ADASOS to remediate an origin-root SEO issue.",
    private: false,
    auto_init: true,
  });
  if (!data) {
    throw new GitHubApiError("GitHub did not return the created repository.", null, "/user/repos");
  }
  return { fullName: data.full_name, defaultBranch: data.default_branch, alreadyExisted: false };
}

/**
 * Section 4: real GitHub Pages configuration via the real Pages API --
 * never assumes branch name or build mode. Reads back the REAL, current
 * configuration first (getPagesConfiguration(), the same function
 * isEligibleForTask()/execute() already use) so a retry after a partial
 * failure never re-configures something already real and correct (Section
 * 8's "no duplicate Pages configuration"). A 409 from the create call
 * itself (GitHub's own "Pages is already enabled" response) is treated the
 * same way -- read back the real state rather than treating it as a
 * failure.
 */
export async function configureRootSitePages(accessToken: string, repositoryFullName: string, branch: string): Promise<PagesConfiguration> {
  const already = await getPagesConfiguration(accessToken, repositoryFullName);
  if (already.enabled) {
    return already;
  }
  try {
    await githubRequest(accessToken, "POST", `/repos/${repositoryFullName}/pages`, { source: { branch, path: "/" } });
  } catch (error) {
    if (!(error instanceof GitHubApiError && error.status === 409)) {
      throw error;
    }
  }
  return getPagesConfiguration(accessToken, repositoryFullName);
}

export interface CanonicalLinkFixResult {
  readonly html: string;
  readonly changed: boolean;
}

/**
 * Pure, targeted <link rel="canonical"> correction against real, current
 * HTML -- never touches anything else on the page. If a canonical tag
 * exists (in any attribute order), its href is rewritten in place; if none
 * exists at all, a new one is inserted right after </title>. Returns
 * changed:false (never throws) when the file has no <title> to anchor a
 * new tag to -- execute() treats that as a real reason to refuse the
 * commit rather than guess where to insert one.
 */
export function applyCanonicalLinkFix(html: string, newHref: string): CanonicalLinkFixResult {
  const canonicalTagPattern = /<link\b[^>]*\brel=["']canonical["'][^>]*>/i;
  const existing = html.match(canonicalTagPattern);
  if (existing) {
    const oldTag = existing[0];
    const newTag = /\bhref=["'][^"']*["']/i.test(oldTag) ? oldTag.replace(/\bhref=["'][^"']*["']/i, `href="${newHref}"`) : oldTag.replace(/\/?>$/, ` href="${newHref}">`);
    const html2 = html.slice(0, existing.index) + newTag + html.slice((existing.index ?? 0) + oldTag.length);
    return { html: html2, changed: html2 !== html };
  }

  const titleCloseTag = /<\/title>/i;
  if (!titleCloseTag.test(html)) {
    return { html, changed: false };
  }
  const html2 = html.replace(titleCloseTag, (match) => `${match}\n<link rel="canonical" href="${newHref}">`);
  return { html: html2, changed: true };
}

export class GitHubRepositoryAdapter {
  readonly capability = GITHUB_REPOSITORY_CAPABILITY;
  readonly tool = GITHUB_REPOSITORY_TOOL;

  /**
   * The real, per-workspace, per-RESOURCE eligibility check
   * RemediationExecutionBridge.hasRealAdapterForTask() calls before approval
   * is ever requested (see remediation-execution-bridge.ts's own
   * RemediationExecutionAdapter interface, and
   * remediation-orchestrator.ts's own "APPROVAL ORDERING" comment -- this
   * runs BEFORE an approval card is ever created). Two genuinely different
   * kinds of ineligibility are distinguished by the reason's prefix, since
   * callers need to react to them differently:
   *
   *   "BLOCKED — external authorization required: ..." -- a connection/
   *   credential problem. Reconnecting or fixing the credential can make
   *   this eligible later; never persisted as a permanent "don't ask
   *   again" fact.
   *
   *   "NOT_REMEDIABLE: ..." -- the connection is genuinely valid, but this
   *   SPECIFIC affected resource can never be controlled by it (Section 3
   *   of the issue-selection task: outside the adapter's approved scope,
   *   or outside what this repository's real, live deployment actually
   *   serves). This is a structural fact about the (resource, connection)
   *   pair, not a transient auth problem -- the caller (web/src/server/
   *   backend/remediation.ts) persists this so the SAME target is never
   *   re-offered as a candidate again for the same connection.
   */
  async isEligibleForTask(task: RemediationTaskLike): Promise<{ eligible: boolean; reason: string }> {
    const access = await this.validateAccess(task.workspaceId);
    if (!access.eligible || !access.connection || !access.accessToken) {
      return { eligible: false, reason: `BLOCKED — external authorization required: ${access.reason}` };
    }

    const scope = await this.validateScope(task);
    if (!scope) {
      return {
        eligible: false,
        reason: `NOT_REMEDIABLE: "${task.affectedResource}" is outside this adapter's approved remediation scope (allowed: this deployment's own origin-root robots.txt, its own origin-root sitemap.xml, or its own homepage's canonical link).`,
      };
    }

    const pages = await getPagesConfiguration(access.accessToken, access.connection.repositoryFullName);
    if (!pages.enabled || !pages.sourceBranch || !pages.liveUrl) {
      return {
        eligible: false,
        reason: `NOT_REMEDIABLE: GitHub Pages configuration could not be determined for "${access.connection.repositoryFullName}" via the API -- this connection cannot verify it controls, deploys, or serves any live resource.`,
      };
    }

    const coverage = resourceIsCoveredByLiveUrl(task.affectedResource, pages.liveUrl);
    if (!coverage.covered) {
      // ORIGIN-ROOT CAPABILITY (2026-08-15): the connected repository's own
      // real, live deployment genuinely does not cover this resource -- but
      // for an origin-root resource specifically, that can mean the RIGHT
      // repository for this job is a DIFFERENT one this same account may
      // control (a "{accountLogin}.github.io" user/org-site repository),
      // not connected right now. describeOriginRootAlternative() makes one
      // additional real, live check ONLY in that specific case (never for
      // an ordinary out-of-scope mismatch) and appends an honest, actionable
      // next step -- switch repositories via the picker, or "none exists" --
      // never fabricating that the CURRENT connection controls it.
      const alternative = await describeOriginRootAlternative(task.affectedResource, access.connection.accountLogin, access.accessToken, access.connection.repositoryFullName);
      return {
        eligible: false,
        reason: `NOT_REMEDIABLE: this repository's real, live GitHub Pages deployment (at "${pages.liveUrl}") does not control "${task.affectedResource}" -- ${coverage.detail} Executing, deploying, and live-verifying a fix here would all target a resource this connection cannot actually affect.${alternative}`,
      };
    }

    return { eligible: true, reason: "Real connection verified; the affected resource is within this repository's real, deployed scope." };
  }

  /**
   * ROOT-SITE PROVISIONING CAPABILITY (2026-08-16), Section 1: only
   * meaningful to call for a task whose ordinary isEligibleForTask() would
   * reach the origin-root NOT_REMEDIABLE case -- re-runs the same real
   * access/scope/coverage checks (never assumes the caller already did, so
   * this is safe to call standalone) and, only for the exact "root-site repo
   * doesn't exist yet" condition, returns a real, structured provisioning
   * plan instead of `null`. Every other outcome (ineligible connection, out
   * of scope, already covered, root repo exists in some other form) returns
   * `null` -- the caller falls back to the existing, unchanged
   * isEligibleForTask()/NOT_REMEDIABLE path.
   */
  async checkRootSiteProvisioningCandidate(task: RemediationTaskLike): Promise<RootSiteProvisioningPlan | null> {
    const access = await this.validateAccess(task.workspaceId);
    if (!access.eligible || !access.connection || !access.accessToken) {
      return null;
    }
    const scope = await this.validateScope(task);
    if (!scope || scope.originRelativePath !== "robots.txt") {
      // Provisioning is only meaningful for the diagnosed robots.txt case --
      // the canonical-link remediation type has no equivalent "create a
      // root site for me" story (a homepage that doesn't exist yet can't be
      // canonicalized).
      return null;
    }
    const pages = await getPagesConfiguration(access.accessToken, access.connection.repositoryFullName);
    if (pages.enabled && pages.liveUrl) {
      const coverage = resourceIsCoveredByLiveUrl(task.affectedResource, pages.liveUrl);
      if (coverage.covered) {
        return null; // Already covered by the current connection -- nothing to provision.
      }
    }
    return checkRootSiteProvisioningPlan(task.affectedResource, access.connection.accountLogin, access.accessToken, access.connection.repositoryFullName, access.connection.id);
  }

  /**
   * Sections 3-6: the real, multi-step provisioning execution -- create (if
   * needed) -> configure Pages (reading the real default branch, never
   * assumed) -> commit the approved robots.txt at the repository ROOT ("robots.txt",
   * never "{repo}/robots.txt"). Re-validates the connection fresh (Section
   * 10: never trusts the plan's own captured connectionId without a live
   * recheck) and refuses if the connection has changed since the plan was
   * approved. Every failure mode returns success:false with the real,
   * specific GitHub error/permission gap -- never a fabricated success.
   */
  async provisionRootSite(plan: RootSiteProvisioningPlan, workspaceId: string): Promise<AdapterExecutionOutcome & { readonly repositoryFullName?: string; readonly sourceBranch?: string }> {
    const access = await this.validateAccess(workspaceId);
    if (!access.eligible || !access.connection || !access.accessToken) {
      return { success: false, detail: `BLOCKED — external authorization required: ${access.reason}` };
    }
    if (access.connection.id !== plan.connectionId) {
      return { success: false, detail: "BLOCKED — the GitHub connection has changed since this provisioning plan was approved. Ask ADASOS to re-diagnose and re-propose." };
    }

    let created: RepositoryCreationResult;
    try {
      created = await createRootSiteRepository(access.accessToken, plan.accountLogin);
    } catch (error) {
      const reason = error instanceof GitHubApiError ? `${error.message} (HTTP ${error.status ?? "unknown"})` : error instanceof Error ? error.message : "an unknown error";
      return { success: false, detail: `BLOCKED — repository creation for "${plan.repositoryToCreate}" failed: ${reason}. This typically requires the connected GitHub OAuth authorization to include repository-creation permission.` };
    }

    let pages: PagesConfiguration;
    try {
      pages = await configureRootSitePages(access.accessToken, created.fullName, created.defaultBranch);
    } catch (error) {
      const reason = error instanceof GitHubApiError ? `${error.message} (HTTP ${error.status ?? "unknown"})` : error instanceof Error ? error.message : "an unknown error";
      return { success: false, detail: `BLOCKED — GitHub Pages configuration for "${created.fullName}" failed: ${reason}. This typically requires administration/Pages permission on the repository. The repository itself was ${created.alreadyExisted ? "already present" : "created"} and left in place.` };
    }
    if (!pages.enabled || !pages.sourceBranch) {
      return { success: false, detail: `GitHub Pages configuration for "${created.fullName}" could not be confirmed via the API after the configure call.` };
    }

    const current = await readRepositoryFile(access.accessToken, created.fullName, plan.fileToWrite, pages.sourceBranch);
    try {
      const commit = await commitFile(
        access.accessToken,
        created.fullName,
        plan.fileToWrite,
        pages.sourceBranch,
        plan.fileContent,
        `ADASOS: provision root-site ${plan.fileToWrite}`,
        current.sha,
      );
      return {
        success: true,
        detail: `Created "${created.fullName}" (${created.alreadyExisted ? "already existed" : "new"}), configured GitHub Pages on branch "${pages.sourceBranch}", and committed ${plan.fileToWrite} (commit ${commit.commitSha}).`,
        repositoryFullName: created.fullName,
        sourceBranch: pages.sourceBranch,
        rollbackData: {
          path: plan.fileToWrite,
          branch: pages.sourceBranch,
          previousContent: current.exists ? current.content : null,
          previousSha: current.exists ? current.sha : null,
        },
      };
    } catch (error) {
      const reason = error instanceof GitHubApiError ? error.message : error instanceof Error ? error.message : "an unknown error";
      return { success: false, detail: `Repository created and Pages configured, but the commit of ${plan.fileToWrite} failed: ${reason}.`, repositoryFullName: created.fullName, sourceBranch: pages.sourceBranch };
    }
  }

  /** Section 2/13: real, structured access validation -- connection exists, is active, and a real API call proves the token can actually reach the authorized repository right now. Never assumed from stored state alone. */
  async validateAccess(userId: string): Promise<{ eligible: boolean; reason: string; connection?: GitHubConnectionRecord; accessToken?: string }> {
    const resolved = await getDecryptedConnection(userId);
    if (!resolved) {
      return { eligible: false, reason: "No active GitHub connection is configured for this workspace." };
    }
    try {
      const { status } = await githubRequest(resolved.accessToken, "GET", `/repos/${resolved.record.repositoryFullName}`);
      if (status === 404) {
        return { eligible: false, reason: `The authorized repository "${resolved.record.repositoryFullName}" is not reachable with the connected credential.` };
      }
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 401 || error.status === 403)) {
        await db.gitHubConnection.update({ where: { userId }, data: { status: "invalid" } });
        return { eligible: false, reason: "The connected GitHub credential is no longer valid (expired or revoked upstream)." };
      }
      throw error;
    }
    return { eligible: true, reason: "Real connection verified.", connection: resolved.record, accessToken: resolved.accessToken };
  }

  /** Resolves the origin-relative URL path this affected resource maps to, applying the standard static-site "trailing slash means index.html" convention. Pure, no network. Shared by validateScope() and isEligibleForTask()'s own coverage check. */
  private resolveOriginRelativePath(affectedResource: string): string | null {
    let url: URL;
    try {
      url = new URL(affectedResource);
    } catch {
      return null;
    }
    let path = url.pathname.replace(/^\//, "");
    if (path === "" || path.endsWith("/")) {
      path += "index.html";
    }
    return path;
  }

  /**
   * Section 9: refuses any target outside the explicit remediation-safe
   * path allowlist -- never a scope an approved SEO task didn't ask for.
   * Deliberately no GitHub network call -- see execute()'s own comment on
   * why this runs BEFORE validateAccess(): an out-of-scope request must
   * never even attempt a real GitHub API call. It DOES do one local DB read
   * (never a network call to GitHub, costs nothing in rate limit or
   * upstream activity) to learn the connected repository's own name --
   * required to derive the homepage's real origin-relative path instead of
   * a hardcoded literal (this task's own "do NOT hardcode one repository
   * name" rule; see classifyPagesSiteTopology()'s own header). robots.txt
   * itself never needs this lookup -- it is always origin-relative
   * "robots.txt" regardless of topology, so that check stays instant and
   * connection-independent. Returns the origin-relative path (a coarse,
   * pre-network safety key) and which operation it maps to -- NOT the real
   * repository file path to write, which execute() computes separately
   * once it has real Pages config (see execute()'s own comment on why
   * those differ).
   */
  private async validateScope(task: RemediationTaskLike): Promise<{ originRelativePath: string; operation: RemediationOperation } | null> {
    const path = this.resolveOriginRelativePath(task.affectedResource);
    if (!path) {
      return null;
    }
    // robots.txt is a real web-crawler standard requiring the true domain
    // root to apply site-wide -- ALWAYS origin-relative "robots.txt"
    // regardless of Pages topology, never project-relative. Instant and
    // connection-independent (no DB read needed) -- see this method's own
    // header.
    if (path === "robots.txt") {
      return { originRelativePath: path, operation: "replace_file" };
    }
    // PROJECT-SITE TARGETING FIX (2026-08-22): sitemap.xml has no such
    // domain-root requirement (per the Sitemaps protocol it can live at any
    // path the site controls) -- sitemap-remediation-planner.ts now resolves
    // its affectedResource relative to the connected repository's own real
    // deployed path, so this must accept EITHER the bare origin-relative
    // "sitemap.xml" (a user/org-site repository, whose deployment root IS
    // the origin) OR "{projectSegment}/sitemap.xml" (a project-site
    // repository) -- the SAME real, live-derived topology the homepage/
    // canonical case below already uses, never a hardcoded literal.
    const connection = await db.gitHubConnection.findUnique({ where: { userId: task.workspaceId }, select: { repositoryFullName: true, accountLogin: true } });
    if (!connection?.repositoryFullName) {
      return null;
    }
    const projectSegment = projectSitePathSegment(connection.repositoryFullName, connection.accountLogin);
    const expectedSitemapPath = projectSegment ? `${projectSegment}/sitemap.xml` : "sitemap.xml";
    if (path === expectedSitemapPath) {
      return { originRelativePath: path, operation: "replace_file" };
    }
    // Only the homepage's own real origin-relative path is otherwise
    // in-scope -- derived from the SAME real Pages topology just resolved
    // above, never a hardcoded literal.
    const expectedHomepagePath = projectSegment ? `${projectSegment}/index.html` : "index.html";
    if (path !== expectedHomepagePath) {
      return null;
    }
    const operation = REMEDIATION_OPERATIONS.get("index.html");
    if (!operation) {
      return null;
    }
    return { originRelativePath: path, operation };
  }

  async execute(task: RemediationTaskLike): Promise<AdapterExecutionOutcome> {
    // Scope refused before any real GitHub API call -- see validateScope()'s
    // own comment.
    const scope = await this.validateScope(task);
    if (!scope) {
      return { success: false, detail: `Refused: "${task.affectedResource}" is outside this adapter's approved remediation scope (allowed: this deployment's own origin-root robots.txt, its own origin-root sitemap.xml, or its own homepage's canonical link).` };
    }

    const access = await this.validateAccess(task.workspaceId);
    if (!access.eligible || !access.connection || !access.accessToken) {
      return { success: false, detail: `BLOCKED — external authorization required: ${access.reason}` };
    }
    const { connection, accessToken } = access;

    const pages = await getPagesConfiguration(accessToken, connection.repositoryFullName);
    if (!pages.enabled || !pages.sourceBranch || !pages.liveUrl) {
      return {
        success: false,
        detail: `BLOCKED — external authorization required: GitHub Pages configuration could not be determined for "${connection.repositoryFullName}" via the API. Cannot safely target a deployment branch/path without it.`,
      };
    }

    const coverage = resourceIsCoveredByLiveUrl(task.affectedResource, pages.liveUrl);
    if (!coverage.covered) {
      // Defense in depth -- isEligibleForTask() already checks this before
      // approval is ever requested, so reaching here with a mismatch would
      // mean the deployment changed between approval and execution.
      return { success: false, detail: `BLOCKED — external authorization required: this repository's real, live deployment (at "${pages.liveUrl}") no longer covers "${task.affectedResource}" -- ${coverage.detail}` };
    }

    // The REAL repository file path is computed relative to the
    // deployment's OWN real liveUrl prefix, never relative to the bare
    // origin -- a GitHub Pages PROJECT site's URL includes a repo-name
    // segment (e.g. "/portfolio-website/") that is a URL-ROUTING artifact
    // only, never part of the repository's own file tree. Stripping the
    // real liveUrl prefix (rather than assuming the origin-relative path
    // IS the file path) is what makes this correct for both project sites
    // and user/org sites without special-casing either.
    const affectedUrl = new URL(task.affectedResource);
    const liveUrlObj = new URL(pages.liveUrl);
    const livePrefix = liveUrlObj.pathname.endsWith("/") ? liveUrlObj.pathname : `${liveUrlObj.pathname}/`;
    let relativeWithinDeployment = affectedUrl.pathname.startsWith(livePrefix) ? affectedUrl.pathname.slice(livePrefix.length) : affectedUrl.pathname.replace(/^\//, "");
    if (relativeWithinDeployment === "" || relativeWithinDeployment.endsWith("/")) {
      relativeWithinDeployment += "index.html";
    }
    const targetPath = pages.sourcePath ? `${pages.sourcePath}/${relativeWithinDeployment}` : relativeWithinDeployment;

    const current = await readRepositoryFile(accessToken, connection.repositoryFullName, targetPath, pages.sourceBranch);

    let newContent: string;
    if (scope.operation === "replace_file") {
      newContent = task.proposedAction;
    } else {
      // set_canonical_link: a targeted <link rel="canonical"> correction
      // against the REAL, current file content -- never a stale, pre-baked
      // full-page snapshot, and never touches anything else on the page.
      if (!current.exists || current.content === null) {
        return { success: false, detail: `The real file "${targetPath}" does not exist in the repository -- cannot apply a targeted canonical-link fix to a file that isn't there.` };
      }
      const applied = applyCanonicalLinkFix(current.content, task.proposedAction);
      if (!applied.changed) {
        return { success: false, detail: `The real, current content of "${targetPath}" no longer needs this fix (already correct, or the proposed change no longer applies) -- refusing to commit a no-op.` };
      }
      newContent = applied.html;
    }

    try {
      const commit = await commitFile(
        accessToken,
        connection.repositoryFullName,
        targetPath,
        pages.sourceBranch,
        newContent,
        `ADASOS remediation: add/update ${targetPath} (task ${task.taskId})`,
        current.sha,
      );
      await db.gitHubConnection.update({ where: { userId: task.workspaceId }, data: { lastUsedAt: new Date() } });
      return {
        success: true,
        detail: `Committed ${targetPath} on branch "${pages.sourceBranch}" (commit ${commit.commitSha}). GitHub Pages build type: ${pages.buildType}.`,
        // Real, captured pre-change state -- the EXACT content/sha read
        // immediately before this commit, never invented. `previousContent`
        // is null when the file genuinely did not exist yet (rollback()
        // deletes it back to that state); otherwise it's the real content
        // to restore. This is what makes automatic rollback (Section 1 of
        // the production-hardening task) possible even in a LATER,
        // separate resumeVerification() call -- captured once, here, and
        // carried through on the task itself from this point on.
        rollbackData: {
          path: targetPath,
          branch: pages.sourceBranch,
          previousContent: current.exists ? current.content : null,
          previousSha: current.exists ? current.sha : null,
        },
      };
    } catch (error) {
      const reason = error instanceof GitHubApiError ? error.message : error instanceof Error ? error.message : "an unknown error";
      return { success: false, detail: `The real commit attempt failed: ${reason}` };
    }
  }

  /**
   * PRODUCTION HARDENING (2026-08-14), Section 1: real, safe, idempotent
   * rollback -- restores the exact pre-change state captured by execute()
   * (task.rollbackData), or deletes the file if it genuinely didn't exist
   * before. Only ever called by the orchestrator after a GENUINE terminal
   * verification failure (never for transient propagation delay -- see
   * remediation-orchestrator.ts's own resumeVerification()). Re-validates
   * access fresh (never assumes the connection captured at execute() time
   * is still valid) and re-reads the CURRENT file state (never assumes
   * nothing has changed since execute()) before deciding what to do --
   * idempotent by construction: if the current state already matches the
   * pre-change target, this is a real, honest no-op, not a duplicate
   * commit.
   */
  async rollback(task: RemediationTaskLike): Promise<{ readonly success: boolean; readonly detail: string }> {
    const rollbackData = task.rollbackData;
    if (!rollbackData) {
      return { success: false, detail: "No captured pre-change state is available for this task -- cannot safely roll back." };
    }

    const access = await this.validateAccess(task.workspaceId);
    if (!access.eligible || !access.connection || !access.accessToken) {
      return { success: false, detail: `BLOCKED — external authorization required: ${access.reason}` };
    }
    const { connection, accessToken } = access;

    const current = await readRepositoryFile(accessToken, connection.repositoryFullName, rollbackData.path, rollbackData.branch);

    // IDEMPOTENCY (Section 1, requirement 10): if the real, current state
    // already matches the pre-change target -- e.g. a previous rollback
    // attempt already succeeded, or another real change already restored
    // it -- this is a genuine no-op, never a duplicate commit.
    const alreadyAtTarget = rollbackData.previousContent === null ? !current.exists : current.content === rollbackData.previousContent;
    if (alreadyAtTarget) {
      return { success: true, detail: `"${rollbackData.path}" already matches its real, pre-change state -- rollback is a safe no-op.` };
    }

    try {
      if (rollbackData.previousContent === null) {
        if (!current.exists || !current.sha) {
          return { success: true, detail: `"${rollbackData.path}" no longer exists -- the rollback target is already achieved.` };
        }
        await deleteFile(accessToken, connection.repositoryFullName, rollbackData.path, rollbackData.branch, current.sha, `ADASOS automatic rollback: revert ${rollbackData.path} (task ${task.taskId}) after terminal verification failure`);
      } else {
        await rollbackFile(accessToken, connection.repositoryFullName, rollbackData.path, rollbackData.branch, rollbackData.previousContent, current.sha ?? rollbackData.previousSha ?? "");
      }
    } catch (error) {
      const reason = error instanceof GitHubApiError ? error.message : error instanceof Error ? error.message : "an unknown error";
      return { success: false, detail: `The real rollback commit attempt failed: ${reason}` };
    }

    // Verify rollback itself succeeded (Section 1, requirement 6) -- a
    // real, independent read-back, never assumed from the commit call
    // alone succeeding.
    const after = await readRepositoryFile(accessToken, connection.repositoryFullName, rollbackData.path, rollbackData.branch);
    const succeeded = rollbackData.previousContent === null ? !after.exists : after.content === rollbackData.previousContent;
    if (!succeeded) {
      return { success: false, detail: `The rollback commit succeeded, but a real read-back of "${rollbackData.path}" does not match its expected pre-change state.` };
    }
    return { success: true, detail: `Rolled back "${rollbackData.path}" on branch "${rollbackData.branch}" to its real, pre-change state and verified via a real read-back.` };
  }
}
