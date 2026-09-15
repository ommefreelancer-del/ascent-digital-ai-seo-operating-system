// WEB DEVELOPMENT AGENT GITHUB-ACCESS FIX: closes the real capability gap
// reported against the Web Development Agent -- correctly routed by
// task-router.ts (assignedAgentId === "web-development-agent"), but with no
// real execution branch wired into api/workspace/messages/route.ts, so every
// request fell through to the generic, tool-less Claude role-play branch
// (the same "CAPABILITY-REGISTRY VS. REAL EXECUTION" gap capability-
// classifier.ts documents for every non-dispatch-wired agent -- see
// prospecting.ts/campaign-tracking.ts for the same fix applied to their own
// agents). That fallback can only ever describe HTML/CSS in prose; it has no
// tool that can read or write a real file, which is exactly the reported
// symptom.
//
// Deliberately does NOT call the frozen WebDevelopmentAgent
// (src/agents/web-development-agent) -- per that agent's own header, it
// requires websiteAudit+technicalSeo as mandatory inputs and drafts
// ISOLATED, per-ticket code snippets with no awareness of a file's actual
// existing content ("if the task requires... a specific existing file's
// contents, write the snippet around that gap"). A real visual redesign
// needs the opposite: whole-file-aware generation grounded in the file's
// REAL current HTML/CSS. This module is a new, self-contained real
// capability -- the same architectural pattern already used for
// prospecting-agent/campaign-tracking-agent: the frozen agent stays
// completely untouched (no rebuild), and the web layer gives its
// assignedAgentId a real execution branch instead.
//
// Reuses the EXISTING GitHub integration exactly as-is:
// GitHubRepositoryAdapter.validateAccess(), getPagesConfiguration(),
// readRepositoryFile(), commitFile() -- all already in server/github.ts,
// unmodified. The only addition to that file is listRepositoryTree(), a new,
// generic, READ-ONLY wrapper around GitHub's own recursive tree API (needed
// because until now this module could only read a file whose path was
// already known -- there was no way to discover what a connected repository
// actually contains). Nothing here is scoped to one repository name --
// every path is derived from this connection's own real Pages configuration
// and real file tree, never hardcoded.
//
// GLOBAL_RULES.md SS9 (human approval before a production-affecting change):
// this module never commits on the same call that proposes a change -- see
// server/backend/approval.ts's own DEPLOY_PRODUCTION_CHANGE_REASON
// convention ("a non-interactive web request cannot supply genuine human
// authorization... stays pending real approval"), which this mirrors with
// its own durable, workspace-scoped WebDevelopmentChange row (a separate
// model from RemediationApproval -- see that model's own schema comment for
// why: RemediationApproval is bound to RemediationOrchestrator's Doctor Flow
// lifecycle and github.ts's execute() is hard-scoped to
// robots.txt/sitemap.xml/canonical-link only; a full-file visual redesign of
// arbitrary website files is a genuinely different capability, not a
// remediation finding).
//
// ANTI-FABRICATION: every proposed file's "previous" state is read live from
// GitHub immediately before drafting; the LLM only ever sees and edits real,
// current content. preservesExistingContent() is a real, mechanical check
// (never trusted to the model's own claim) that the large majority of the
// original page's real visible sentences still appear in its proposed
// replacement -- a file that fails this check is left out of the change
// entirely rather than risking silent content loss on a live, public site.
// The shared stylesheet is never wholesale-replaced -- new rules are
// appended under a clearly labeled block so no existing CSS can be
// silently altered or dropped.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/server/db";
import { GitHubRepositoryAdapter, getPagesConfiguration, listRepositoryTree, readRepositoryFile, commitFile, resourceIsCoveredByLiveUrl } from "@/server/github";

const adapter = new GitHubRepositoryAdapter();
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8000;
// Renamed from MAX_HTML_FILES (NO-FILE-CHANGES FIX below): this budget now
// covers ANY real repository file selected as a target -- HTML pages via the
// existing nav-crawl relevance scoring, AND any file the user's own message
// names explicitly (README.md, SECURITY.md, etc.) -- not just HTML.
const MAX_TARGET_FILES = 4;
const MAX_CSS_FILES = 2;

const APPEND_MARKER = "/* ===== ADASOS Web Development Agent: appended styles ===== */";

export interface ProposedFile {
  readonly path: string;
  readonly previousContent: string;
  readonly previousSha: string;
  readonly newContent: string;
}

export interface RepositoryFileState {
  readonly content: string;
  readonly sha: string;
}

export interface WebDevelopmentPlanResult {
  readonly ok: boolean;
  readonly changeId?: string;
  readonly repositoryFullName?: string;
  readonly targetUrl?: string;
  readonly changedFiles?: readonly string[];
  readonly consideredButUnchangedFiles?: readonly string[];
  /** Real, honest reason a considered file did not end up in the change (e.g. failed the content-preservation check). Never silent. */
  readonly skippedFileReasons?: readonly string[];
  /** The real repository file paths actually shown to the code-generation provider -- included so a "no changes" outcome is diagnosable (was the right file even inspected?) rather than an opaque dead end. */
  readonly inspectedFiles?: readonly string[];
  /** Set only when ok:false -- a real, specific tool/permission/data failure, never a generic message (requirement 10: "clearly report a real tool/permission failure"). */
  readonly failureReason?: string;
}

export interface WebDevelopmentApplyResult {
  readonly ok: boolean;
  readonly commits?: readonly { path: string; commitSha: string }[];
  readonly error?: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Real, mechanical content-preservation check -- never trusts the LLM's own claim that it kept existing content. Requires the large majority of the original file's real, significant sentences to still appear verbatim (after tag-stripping) in the proposed replacement. Works for any text file, not just HTML -- stripTags() is a harmless no-op on plain text/markdown (there are no tags to strip). */
export function preservesExistingContent(originalHtml: string, newHtml: string): boolean {
  const originalText = stripTags(originalHtml);
  const newText = stripTags(newHtml);
  const originalSentences = originalText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);
  if (originalSentences.length === 0) return true;
  const preserved = originalSentences.filter((s) => newText.includes(s));
  return preserved.length / originalSentences.length >= 0.85;
}

function resolveRelativePath(fromPath: string, href: string): string | null {
  if (/^https?:\/\//i.test(href) || href.startsWith("//") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#") || href.startsWith("javascript:")) {
    return null;
  }
  const cleanHref = (href.split("#")[0] ?? "").split("?")[0] ?? "";
  if (!cleanHref) return null;
  const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const segments = cleanHref.startsWith("/") ? cleanHref.replace(/^\//, "").split("/") : (fromDir ? fromDir.split("/") : []).concat(cleanHref.split("/"));
  const resolved: string[] = [];
  for (const part of segments) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  let result = resolved.join("/");
  if (result === "" || result.endsWith("/")) result += "index.html";
  return result;
}

function extractSameSiteLinks(html: string, ownPath: string): string[] {
  const hrefs = Array.from(html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)).map((m) => m[1] ?? "");
  const paths = new Set<string>();
  for (const href of hrefs) {
    const resolved = resolveRelativePath(ownPath, href);
    if (resolved) paths.add(resolved);
  }
  return Array.from(paths);
}

function extractStylesheetPaths(html: string, ownPath: string): string[] {
  const linkTags = Array.from(html.matchAll(/<link\b[^>]*>/gi)).map((m) => m[0]);
  const paths = new Set<string>();
  for (const tag of linkTags) {
    if (!/\brel=["']stylesheet["']/i.test(tag)) continue;
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;
    const resolved = resolveRelativePath(ownPath, hrefMatch[1]);
    if (resolved) paths.add(resolved);
  }
  return Array.from(paths);
}

const REQUEST_STOPWORDS = new Set(["the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "my", "existing", "website", "add", "adding", "improve", "improving", "use", "using", "appropriate", "please"]);

function significantRequestWords(message: string): string[] {
  return Array.from(new Set(message.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !REQUEST_STOPWORDS.has(w))));
}

function scoreRelevance(path: string, requestWords: readonly string[]): number {
  const pathWords = path.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return requestWords.filter((w) => pathWords.some((pw) => pw.includes(w) || w.includes(pw))).length;
}

// NO-FILE-CHANGES ROOT-CAUSE FIX: until now, file discovery only ever
// considered the homepage plus ".html" pages reachable by crawling its own
// <a href> links (extractSameSiteLinks below) -- so a plain, legitimate
// request naming a real, non-HTML repository file directly (a README,
// SECURITY.md, any documentation file -- none of which the homepage links
// to) was NEVER shown to the code-generation provider at all. The provider
// correctly found nothing worth changing among the files it was actually
// given and returned prose instead of a file block, which parseFileBlocks()
// correctly read as zero proposed changes -- an honest result, but for the
// wrong reason (a real, discoverable target file was simply never looked
// at). This is the smallest fix: before falling back to the nav-crawl
// heuristic, check whether the message itself names a real file the
// repository's own tree already contains, and treat that as the strongest,
// least ambiguous signal there is. Generic (no filename hardcoded) -- works
// for any real file in any connected repository.
const GENERIC_BASENAMES: ReadonlySet<string> = new Set(["index"]);

export function findExplicitlyMentionedFiles(message: string, realBlobPaths: ReadonlySet<string>, limit = 3): string[] {
  const lowerMessage = message.toLowerCase();
  const matches: { path: string; specificity: number }[] = [];
  for (const path of realBlobPaths) {
    const base = path.split("/").pop() ?? path;
    const withoutExt = base.replace(/\.[a-z0-9]+$/i, "");
    const lowerBase = withoutExt.toLowerCase();
    if (GENERIC_BASENAMES.has(lowerBase)) continue;

    if (lowerMessage.includes(base.toLowerCase())) {
      // The exact filename (with extension) appears verbatim -- strongest, least ambiguous signal.
      matches.push({ path, specificity: 100 + base.length });
      continue;
    }
    const meaningfulWords = lowerBase.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (meaningfulWords.length > 0 && meaningfulWords.every((w) => new RegExp(`\\b${w}\\b`, "i").test(message))) {
      matches.push({ path, specificity: meaningfulWords.join("").length });
    }
  }
  return matches
    .sort((a, b) => b.specificity - a.specificity)
    .slice(0, limit)
    .map((m) => m.path);
}

function buildPrompt(message: string, files: ReadonlyMap<string, string>, cssPaths: readonly string[]): string {
  const fileBlocks = Array.from(files.entries())
    .map(([path, content]) => `--- FILE: ${path} ---\n${content}\n--- END FILE: ${path} ---`)
    .join("\n\n");

  return [
    "You are implementing a real website change for a live, deployed site. Below are the ACTUAL, CURRENT contents of the real files in this repository. You must work only from what is actually there -- never invent content, credentials, testimonials, client names, certifications, years of experience, or statistics that are not already present.",
    "",
    `User's request: "${message}"`,
    "",
    "Current real files:",
    fileBlocks,
    "",
    "Instructions:",
    "- For each file that genuinely benefits from this request, return its COMPLETE new content (the entire file, not a fragment or a diff). Preserve ALL existing content, links, structure, and functionality exactly unless the request explicitly asks to change it -- you are ADDING/EDITING, not rewriting from scratch.",
    "- For an HTML file specifically: add new visual interest using clean, semantic inline SVG icons/illustrations (never reference an external image URL or file that doesn't already exist) in a professional blue, purple, and white color palette, unless the request specifies otherwise.",
    "- For a documentation/text/markdown file: make only the specific, concrete edit the request describes -- do not add unrelated sections or restructure it.",
    "- Only include a file in your output if you are actually changing it. Do not include a file that needs no change.",
    "- If none of the files shown above are the right target for this request, do not guess -- return no file blocks at all.",
    cssPaths.length > 0
      ? `- For the stylesheet (${cssPaths.join(", ")}), return ONLY the NEW CSS rules to append (not the whole file) -- scope every new rule under new, clearly-named classes that don't collide with or override any existing class, so nothing already there is affected.`
      : "",
    "- Never fabricate business facts (pricing, guarantees, awards, testimonials, team size, years in business) that are not already present in the current content.",
    "",
    "Return your answer as one block per file you are changing, in exactly this format, with no other text before, between, or after the blocks:",
    "===FILE: <path exactly as shown above>===",
    "<complete new content for that file>",
    "===ENDFILE===",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Strips a single outer ``` / ```<lang> ... ``` fence wrapping the ENTIRE response, if present -- a model occasionally wraps its whole answer in one code block despite the prompt's own "no other text" instruction. Only the outer fence is stripped; fences that are part of genuine file content (inside a FILE block) are untouched since this only matches when the fence spans the whole trimmed text. */
function stripOuterCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9]*\r?\n([\s\S]*?)\r?\n```$/);
  return match ? match[1]! : text;
}

/** Real, robust parsing of the provider's file-block response -- tolerant of an outer code fence and CRLF line endings, since a genuine provider response failing to parse here was the exact production defect this fix closes (see NO-FILE-CHANGES ROOT-CAUSE FIX above for the other half: the right file never being shown to the model in the first place). */
export function parseFileBlocks(text: string): Map<string, string> {
  const cleaned = stripOuterCodeFence(text);
  const result = new Map<string, string>();
  const pattern = /===FILE:\s*(.+?)===\r?\n([\s\S]*?)\r?\n===ENDFILE===/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cleaned)) !== null) {
    const path = match[1]?.trim();
    const content = match[2];
    if (path && content !== undefined) result.set(path, content);
  }
  return result;
}

export interface DraftFilesSuccess {
  readonly ok: true;
  readonly proposedFiles: readonly ProposedFile[];
  readonly skippedFileReasons: readonly string[];
  readonly consideredButUnchangedFiles: readonly string[];
  readonly inspectedFiles: readonly string[];
}
export interface DraftFilesFailure {
  readonly ok: false;
  readonly failureReason: string;
}

/**
 * The real drafting-and-validation core, deliberately separated from all
 * GitHub/DB I/O above it (planWebDevelopmentChange() is a thin real-IO
 * wrapper around this) so it can be exercised directly in tests with a fake
 * `generateCode` instead of a real, billed Anthropic call -- this is the
 * function the reported "no file changes" defect actually lives in (parsing
 * + validation), independent of which real files were selected to feed it
 * (see findExplicitlyMentionedFiles() above for that half of the fix).
 * `generateCode` returning `null` (a genuinely unavailable/failed provider)
 * is handled identically to the real Anthropic call failing -- an honest
 * failureReason, never a fabricated change.
 */
export async function draftProposedFiles(
  message: string,
  targetFiles: ReadonlyMap<string, RepositoryFileState>,
  cssFiles: ReadonlyMap<string, RepositoryFileState>,
  generateCode: (prompt: string) => Promise<string | null>,
): Promise<DraftFilesSuccess | DraftFilesFailure> {
  const promptFiles = new Map<string, string>();
  for (const [path, { content }] of targetFiles) promptFiles.set(path, content);
  for (const [path, { content }] of cssFiles) promptFiles.set(path, content);
  const inspectedFiles = Array.from(promptFiles.keys());

  let responseText: string | null;
  try {
    responseText = await generateCode(buildPrompt(message, promptFiles, Array.from(cssFiles.keys())));
  } catch (error) {
    return { ok: false, failureReason: `The real code-generation provider call failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!responseText) {
    return { ok: false, failureReason: "The real code-generation provider returned no usable content for this request." };
  }

  const parsed = parseFileBlocks(responseText);
  if (parsed.size === 0) {
    return {
      ok: false,
      failureReason: `The code-generation provider proposed no file changes for this request. Files inspected: ${inspectedFiles.join(", ") || "none"}. If your request refers to a different file, name it explicitly (e.g. "update README.md").`,
    };
  }

  const proposedFiles: ProposedFile[] = [];
  const skippedFileReasons: string[] = [];
  const consideredButUnchangedFiles: string[] = [];

  for (const [path, newContent] of parsed) {
    if (targetFiles.has(path)) {
      const original = targetFiles.get(path)!;
      if (newContent.trim() === original.content.trim()) {
        consideredButUnchangedFiles.push(path);
        continue;
      }
      if (!preservesExistingContent(original.content, newContent)) {
        skippedFileReasons.push(`"${path}": the proposed change did not preserve enough of the file's existing real content, so it was refused rather than risking content loss.`);
        continue;
      }
      proposedFiles.push({ path, previousContent: original.content, previousSha: original.sha, newContent });
    } else if (cssFiles.has(path)) {
      const original = cssFiles.get(path)!;
      const appended = `${original.content.trimEnd()}\n\n${APPEND_MARKER}\n${newContent.trim()}\n`;
      proposedFiles.push({ path, previousContent: original.content, previousSha: original.sha, newContent: appended });
    } else {
      skippedFileReasons.push(`"${path}": the provider proposed a change to a file that wasn't part of the real files inspected for this request -- refused rather than writing to an unverified path.`);
    }
  }

  if (proposedFiles.length === 0) {
    return {
      ok: false,
      failureReason: `No real, safe change could be produced for this request. ${skippedFileReasons.join(" ") || "The provider's proposed content matched the existing files exactly."}`,
    };
  }

  return { ok: true, proposedFiles, skippedFileReasons, consideredButUnchangedFiles, inspectedFiles };
}

/**
 * Real, chat-dispatch-wired execution for "web-development-agent": inspects
 * the actually-connected repository's real files, drafts a real,
 * whole-file-aware change via a real LLM call, and saves it as a durable,
 * pending-approval row -- never commits here. See this file's own header for
 * the full architecture and why the frozen WebDevelopmentAgent isn't used.
 */
export async function planWebDevelopmentChange(userId: string, message: string, targetUrl: string | null): Promise<WebDevelopmentPlanResult> {
  const access = await adapter.validateAccess(userId);
  if (!access.eligible || !access.connection || !access.accessToken) {
    return { ok: false, failureReason: `BLOCKED — external authorization required: ${access.reason}` };
  }
  const { connection, accessToken } = access;

  const pages = await getPagesConfiguration(accessToken, connection.repositoryFullName);
  if (!pages.enabled || !pages.sourceBranch || !pages.liveUrl) {
    return { ok: false, failureReason: `GitHub Pages configuration could not be determined for "${connection.repositoryFullName}" via the real API -- cannot safely target a deployment branch/path without it.` };
  }

  const effectiveTargetUrl = targetUrl ?? pages.liveUrl;
  const normalizedTarget = effectiveTargetUrl.endsWith("/") ? effectiveTargetUrl : `${effectiveTargetUrl}/`;
  const coverage = resourceIsCoveredByLiveUrl(normalizedTarget, pages.liveUrl);
  if (!coverage.covered) {
    return {
      ok: false,
      failureReason: `The connected repository ("${connection.repositoryFullName}")'s real, live deployment (at "${pages.liveUrl}") does not serve "${effectiveTargetUrl}" -- ${coverage.detail} Connect the repository for this specific website in Settings, or ask about the site whose repository is actually connected.`,
    };
  }

  const rootPath = pages.sourcePath ? `${pages.sourcePath}/index.html` : "index.html";
  const homepage = await readRepositoryFile(accessToken, connection.repositoryFullName, rootPath, pages.sourceBranch);
  if (!homepage.exists || homepage.content === null || !homepage.sha) {
    return { ok: false, failureReason: `The real homepage file "${rootPath}" does not exist in "${connection.repositoryFullName}" on branch "${pages.sourceBranch}" -- cannot inspect the existing implementation.` };
  }

  const tree = await listRepositoryTree(accessToken, connection.repositoryFullName, pages.sourceBranch);
  const realBlobPaths = new Set(tree.filter((e) => e.type === "blob").map((e) => e.path));

  // NO-FILE-CHANGES ROOT-CAUSE FIX: an explicitly named real file (e.g. a
  // documentation request naming "README.md") is now discovered FIRST and
  // takes priority -- previously only ".html" pages reachable by crawling
  // the homepage's own <a href> links were ever considered, so a real,
  // legitimate request about any other real file was never shown to the
  // code-generation provider at all (see findExplicitlyMentionedFiles()'s
  // own header for the full explanation).
  const explicitMatches = findExplicitlyMentionedFiles(message, realBlobPaths, MAX_TARGET_FILES - 1).filter((p) => p !== rootPath);

  const requestWords = significantRequestWords(message);
  const candidateLinks = extractSameSiteLinks(homepage.content, rootPath).filter((p) => realBlobPaths.has(p) && p !== rootPath && p.endsWith(".html") && !explicitMatches.includes(p));
  const remainingSlots = Math.max(0, MAX_TARGET_FILES - 1 - explicitMatches.length);
  const rankedLinks = candidateLinks
    .map((path) => ({ path, score: scoreRelevance(path, requestWords) }))
    .sort((a, b) => b.score - a.score)
    .filter((c) => c.score > 0)
    .slice(0, remainingSlots)
    .map((c) => c.path);

  const otherPaths = [...explicitMatches, ...rankedLinks];
  const targetFiles = new Map<string, RepositoryFileState>();
  targetFiles.set(rootPath, { content: homepage.content, sha: homepage.sha });
  for (const path of otherPaths) {
    const file = await readRepositoryFile(accessToken, connection.repositoryFullName, path, pages.sourceBranch);
    if (file.exists && file.content !== null && file.sha) {
      targetFiles.set(path, { content: file.content, sha: file.sha });
    }
  }

  const cssCandidatePaths = new Set<string>();
  for (const [path, { content }] of targetFiles) {
    for (const cssPath of extractStylesheetPaths(content, path)) {
      if (realBlobPaths.has(cssPath)) cssCandidatePaths.add(cssPath);
    }
  }
  const cssPaths = Array.from(cssCandidatePaths).slice(0, MAX_CSS_FILES);
  const cssContents = new Map<string, RepositoryFileState>();
  for (const path of cssPaths) {
    const file = await readRepositoryFile(accessToken, connection.repositoryFullName, path, pages.sourceBranch);
    if (file.exists && file.content !== null && file.sha) {
      cssContents.set(path, { content: file.content, sha: file.sha });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, failureReason: "ANTHROPIC_API_KEY is not configured -- no real code-generation provider is available to draft this change." };
  }
  const client = new Anthropic({ apiKey });
  const generateCode = async (prompt: string): Promise<string | null> => {
    const completion = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    return completion.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? null;
  };

  const drafted = await draftProposedFiles(message, targetFiles, cssContents, generateCode);
  if (!drafted.ok) {
    return { ok: false, failureReason: drafted.failureReason };
  }

  const change = await db.webDevelopmentChange.create({
    data: {
      userId,
      connectionId: connection.id,
      repositoryFullName: connection.repositoryFullName,
      branch: pages.sourceBranch,
      targetUrl: effectiveTargetUrl,
      requestSummary: message,
      filesJson: JSON.stringify(drafted.proposedFiles),
      status: "pending_approval",
    },
  });

  return {
    ok: true,
    changeId: change.id,
    repositoryFullName: connection.repositoryFullName,
    targetUrl: effectiveTargetUrl,
    changedFiles: drafted.proposedFiles.map((f) => f.path),
    consideredButUnchangedFiles: drafted.consideredButUnchangedFiles,
    skippedFileReasons: drafted.skippedFileReasons,
    inspectedFiles: drafted.inspectedFiles,
  };
}

/** Real, human-authorized commit of a previously-planned change -- never called automatically. Re-validates the GitHub connection fresh and refuses if it changed since the change was proposed (mirrors RemediationApproval's own connectionId check). Commits each file sequentially via the real Contents API; a failure partway through is reported honestly with exactly which files did/didn't commit, never papered over. */
export async function applyWebDevelopmentChange(userId: string, changeId: string): Promise<WebDevelopmentApplyResult> {
  const record = await db.webDevelopmentChange.findFirst({ where: { id: changeId, userId } });
  if (!record) {
    return { ok: false, error: "No such pending web development change for this workspace." };
  }
  if (record.status !== "pending_approval") {
    return { ok: false, error: `This change is already "${record.status}" and cannot be applied again.` };
  }

  const access = await adapter.validateAccess(userId);
  if (!access.eligible || !access.connection || !access.accessToken) {
    await db.webDevelopmentChange.update({ where: { id: changeId }, data: { status: "failed", error: `BLOCKED — external authorization required: ${access.reason}`, decidedAt: new Date() } });
    return { ok: false, error: `BLOCKED — external authorization required: ${access.reason}` };
  }
  if (access.connection.id !== record.connectionId) {
    return { ok: false, error: "BLOCKED — the GitHub connection has changed since this change was proposed. Ask ADASOS to re-propose it." };
  }

  const files = JSON.parse(record.filesJson) as ProposedFile[];
  const commits: { path: string; commitSha: string }[] = [];

  for (const file of files) {
    const current = await readRepositoryFile(access.accessToken, record.repositoryFullName, file.path, record.branch);
    try {
      const commit = await commitFile(
        access.accessToken,
        record.repositoryFullName,
        file.path,
        record.branch,
        file.newContent,
        `ADASOS Web Development Agent: update ${file.path}`,
        current.exists ? current.sha : null,
      );
      commits.push({ path: file.path, commitSha: commit.commitSha });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await db.webDevelopmentChange.update({ where: { id: changeId }, data: { status: "failed", error: `Commit of "${file.path}" failed: ${reason}`, commitShasJson: JSON.stringify(commits), decidedAt: new Date() } });
      return { ok: false, error: `Commit of "${file.path}" failed: ${reason}. ${commits.length} file(s) were already committed before this failure: ${commits.map((c) => c.path).join(", ") || "none"}.` };
    }
  }

  await db.webDevelopmentChange.update({ where: { id: changeId }, data: { status: "committed", commitShasJson: JSON.stringify(commits), decidedAt: new Date() } });
  await db.gitHubConnection.update({ where: { userId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { ok: true, commits };
}

export async function rejectWebDevelopmentChange(userId: string, changeId: string): Promise<{ ok: boolean; error?: string }> {
  const record = await db.webDevelopmentChange.findFirst({ where: { id: changeId, userId } });
  if (!record) return { ok: false, error: "No such pending web development change for this workspace." };
  if (record.status !== "pending_approval") return { ok: false, error: `This change is already "${record.status}".` };
  await db.webDevelopmentChange.update({ where: { id: changeId }, data: { status: "rejected", decidedAt: new Date() } });
  return { ok: true };
}

/** Real, non-fabricated chat-facing summary -- every field traced to planWebDevelopmentChange()'s own real result, never invented. */
export function summarizeWebDevelopmentPlanForChat(result: WebDevelopmentPlanResult): string {
  if (!result.ok) {
    return `I looked into this using ADASOS's real, connected GitHub integration, but I can't proceed: ${result.failureReason}`;
  }

  const lines: string[] = [
    `**Real Web Development Agent -- proposed change to ${result.repositoryFullName}** (target: ${result.targetUrl})`,
    "",
    "I read the actual, current files in your connected GitHub repository and drafted a real change:",
  ];
  for (const path of result.changedFiles ?? []) {
    lines.push(`- \`${path}\` -- will be updated`);
  }
  if (result.skippedFileReasons && result.skippedFileReasons.length > 0) {
    lines.push("", "Not applied (refused for safety):");
    for (const reason of result.skippedFileReasons) lines.push(`- ${reason}`);
  }
  lines.push(
    "",
    `This has NOT been committed yet -- per ADASOS's production-change approval rule, a real repository write requires your explicit approval. Change id: \`${result.changeId}\`.`,
    `To apply it: POST /api/workspace/web-development/${result.changeId}/approve (or reject at .../reject).`,
  );
  return lines.join("\n");
}
