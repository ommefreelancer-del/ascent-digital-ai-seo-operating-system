// Pure, dependency-free robots.txt parsing -- consistent with this project's
// existing approach to parsing constrained text formats (see
// src/boss-agent/registry/agent-spec-parser.ts and
// src/agents/website-audit-agent/parsing/html-fact-extractor.ts). Real
// robots.txt content, real rules -- nothing here is inferred or guessed.

export interface RobotsTxtGroup {
  readonly userAgents: readonly string[];
  readonly disallow: readonly string[];
  readonly allow: readonly string[];
}

export interface ParsedRobotsTxt {
  readonly groups: readonly RobotsTxtGroup[];
  readonly sitemaps: readonly string[];
}

export function parseRobotsTxt(content: string): ParsedRobotsTxt {
  const groups: RobotsTxtGroup[] = [];
  const sitemaps: string[] = [];

  let currentUserAgents: string[] = [];
  let currentDisallow: string[] = [];
  let currentAllow: string[] = [];
  let groupHasRules = false;

  const flushGroup = () => {
    if (currentUserAgents.length > 0 && groupHasRules) {
      groups.push({ userAgents: currentUserAgents, disallow: currentDisallow, allow: currentAllow });
    }
    currentDisallow = [];
    currentAllow = [];
    groupHasRules = false;
  };

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const field = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (field === "user-agent") {
      if (groupHasRules) {
        // A new User-agent line after rules were seen starts a new group.
        flushGroup();
        currentUserAgents = [value];
      } else {
        currentUserAgents.push(value);
      }
      continue;
    }
    if (field === "disallow") {
      groupHasRules = true;
      if (value !== "") currentDisallow.push(value);
      continue;
    }
    if (field === "allow") {
      groupHasRules = true;
      currentAllow.push(value);
      continue;
    }
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
  }
  flushGroup();

  return { groups, sitemaps };
}

function pathMatchesRule(path: string, rule: string): boolean {
  if (rule === "") return false;
  // robots.txt wildcards: "*" matches any sequence, "$" anchors end of string.
  const anchored = rule.endsWith("$");
  const pattern = anchored ? rule.slice(0, -1) : rule;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return regex.test(path);
}

/**
 * Evaluates whether `path` is allowed for `userAgent` per the longest-match
 * rule (the de facto standard: the most specific matching Allow/Disallow
 * rule wins). Falls back to the "*" group when no group matches `userAgent`
 * by name.
 */
export function isPathAllowed(parsed: ParsedRobotsTxt, userAgent: string, path: string): boolean {
  const lowerAgent = userAgent.toLowerCase();
  const group =
    parsed.groups.find((g) => g.userAgents.some((ua) => ua.toLowerCase() === lowerAgent)) ??
    parsed.groups.find((g) => g.userAgents.some((ua) => ua === "*"));

  if (!group) return true;

  let bestMatch: { rule: string; type: "allow" | "disallow" } | null = null;
  for (const rule of group.disallow) {
    if (pathMatchesRule(path, rule) && (!bestMatch || rule.length > bestMatch.rule.length)) {
      bestMatch = { rule, type: "disallow" };
    }
  }
  for (const rule of group.allow) {
    if (pathMatchesRule(path, rule) && (!bestMatch || rule.length > bestMatch.rule.length)) {
      bestMatch = { rule, type: "allow" };
    }
  }

  return bestMatch === null || bestMatch.type === "allow";
}
