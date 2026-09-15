// PRODUCTION ROUTING FIX (2026-08-16, broker/router root-cause pass): a
// real, live 27-agent validation round found that generic keyword/tag
// overlap scoring (tag-weighted-routing-strategy.ts) systematically loses
// an EXPLICITLY NAMED specialist to website-audit-agent -- confirmed
// against the real registry: "Validate the On-Page SEO Agent using real
// production evidence." scored website-audit-agent 0.723 vs. on-page-seo-agent
// nowhere in the top 3; the same happened for Off-Page SEO, Local SEO
// (Google Business Profile), Core Web Vitals & Performance, and even
// TECHNICAL SEO AGENT NAMED EXPLICITLY still lost to website-audit-agent
// (0.727 vs 0.440). Root cause: website-audit-agent's own real spec is
// exceptionally broad (17 responsibility bullets + 17 capability bullets
// spanning technical, on-page, performance, structured-data, and
// accessibility topics -- see Agents/website-audit-agent.md, never modified
// here), giving it structurally superior raw term coverage against almost
// any SEO-flavored request. Proportional overlap scoring has no way to
// recognize "this task is EXPLICITLY ABOUT agent X" versus "this task
// happens to share vocabulary with X's broad spec" -- the broader spec
// always wins on raw overlap regardless of which agent a message actually
// names.
//
// This module is the fix: a deterministic tier-0 gate (see task-router.ts's
// own header for exactly where it's wired in, before capability gating/
// scoring) that recognizes an explicitly named specialist agent and
// resolves it directly -- never a fabricated score, never a lowered
// threshold, never a change to any agent's own spec content.
//
// TWO SOURCES of real, grounded name candidates for each of the 27 real
// registered agents:
//   1. The agent's own real, registered `title` (AgentSpec.title, e.g.
//      "Keyword Research & Search Intent Agent") -- built dynamically from
//      whatever registry is passed in, so this covers all 27 agents (and
//      any future one) automatically, with zero hardcoding and zero risk of
//      drifting out of sync with Agents/*.md.
//   2. A small, DISCLOSED alias table for validation-style names that do
//      not map 1:1 onto a real title -- each one grounded in that target
//      agent's own real spec text (cited per entry below), never invented:
//        - "local seo"                    -> google-business-profile-agent
//          (real Tag "local-seo"; real Outputs "Local SEO Strategy" /
//          "Local SEO Recommendations"; real Mission "local search
//          visibility... local business growth").
//        - "google search console",
//          "core web vitals", "core web
//          vitals & performance",
//          "core web vitals and
//          performance"                   -> performance-analytics-agent
//          (real Responsibilities "Analyze Google Search Console data.",
//          "Monitor Core Web Vitals and performance metrics."; real
//          Capabilities "Analyze Google Search Console performance data:
//          clicks, impressions, CTR, and average position", "Analyze Core
//          Web Vitals and real page performance data" -- the most
//          specific, quantified ownership of either topic on the roster).
//        - "link building"                -> off-page-seo-agent
//          (real Tag "link-building"; real Output "Link Building Plan";
//          real Capability "Identify high-quality backlink and
//          link-building opportunities").
//        - "guest posting & outreach",
//          "guest posting and
//          outreach"                      -> guest-posting-digital-pr-agent
//          (the real registered agent this task's own "already passed"
//          regression list names by this informal blend of its real title,
//          "Guest Posting & Digital PR Agent", and its real Input/Receives
//          relationship with outreach-agent).
//        - "schema markup", "structured
//          data"                          -> on-page-seo-agent
//          (real Responsibility "Implement page-level structured data
//          (Schema.org) where applicable" -- an affirmative, ACTION-oriented
//          responsibility, matching "Schema Markup" as a thing to DO;
//          technical-seo-agent's own real responsibility is narrower --
//          "Validate structured data (Schema.org)", i.e. auditing an
//          already-implemented state, closer to website-audit-agent's own
//          real "Validate structured data and Schema.org markup"
//          capability. A genuinely disclosed, disputable choice between two
//          real agents that both legitimately touch schema -- not a
//          fabricated single owner.)
//        - "proposal & sales", "proposal
//          and sales"                     -> business-development-agent
//          (real canonical task already proven in
//          routing-matrix.integration.test.ts: "Qualify this inbound lead
//          and prepare a service proposal with pricing recommendations.").
//        - "client communication"         -> client-relationship-management-agent
//          (real Mission "Centralize client-related operations...
//          coordinating project and campaign status" -- the broadest real
//          owner of general client-facing coordination on the roster,
//          distinct from reply-negotiation-agent's narrower real scope,
//          publisher email negotiation specifically).
//        - "google analytics & reporting",
//          "google analytics and
//          reporting"                     -> performance-analytics-agent
//          (real Tag "google-analytics"; real Input "Google Analytics Data";
//          real Tool "Google Analytics 4"; real Capability "Analyze Google
//          Search Console performance data" -- the most specific, tagged
//          owner of "Google Analytics" as a data source on the roster. A
//          genuinely disclosed, disputable choice: client-reporting-agent
//          also legitimately touches "reporting" -- its own real Tag is
//          "reporting" and its Mission is specifically about client
//          reports -- but it carries no "analytics" tag/capability of its
//          own; "Google Analytics" is the more specific, decisive half of
//          this compound name.)
//        - "content refresh & optimization",
//          "content refresh and
//          optimization", "content
//          refresh"                       -> content-strategy-agent
//          (real Responsibility "Recommend content updates." -- thin but
//          real and explicit; no other agent's spec mentions updating or
//          refreshing EXISTING content at all, only creating new content
//          (seo-content-agent) or optimizing on-page elements
//          (on-page-seo-agent).)
//
// STRICT PRODUCTION REPAIR (2026-08-17) cross-check against a newer task's
// own "27-agent canonical list" also confirmed these names have NO real
// textual home anywhere in Agents/*.md (zero title/tag/capability/
// responsibility hits) and are DELIBERATELY NOT ALIASED here: "Programmatic
// SEO Agent", "E-commerce SEO Agent", "International SEO Agent" (the
// closest real text is website-audit-agent's own "Detect canonical tags,
// hreflang, and indexing directives" -- one detection bullet among ~15,
// too thin and too narrow to alias without silently expanding that agent's
// real, disclosed scope to "owns international SEO strategy"), "AI Prompt
// Engineering Agent", "Automation Workflow" ("workflow" appears only
// generically inside other agents' mission prose, never as a dedicated
// capability), and "Voice Interface" (a genuinely separate module,
// src/voice-interface/, structurally outside Agents/ entirely -- not one of
// the 27 specialists). Per Rule 6.B ("if a required capability does NOT
// exist, do not fake a route"), a message naming one of these is reported
// honestly via findUnresolvedAgentMention() below (escalated as
// "requested_agent_not_found") rather than silently falling through to
// generic scoring, where website-audit-agent's broad spec would otherwise
// hijack it.

import type { AgentDirectory } from "../registry/agent-registry.js";

const STOPWORDS: ReadonlySet<string> = new Set([
  "agent",
  "the",
  "and",
  "for",
  "a",
  "an",
  "of",
  "using",
  "real",
  "production",
  "evidence",
  "test",
  "validate",
  "run",
  "verify",
  "check",
]);

/** Minimum fraction of a candidate name's own distinctive tokens that must appear in an extracted "... Agent" mention to accept the match -- see file header. */
const MIN_MATCH_RATIO = 0.6;

function significantTokens(text: string): ReadonlySet<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** See file header's disclosed alias table -- maps a curated name phrase to a real, registered agent id. Applied only if that id is actually present in the loaded registry. */
const ALIAS_TABLE: readonly { readonly phrase: string; readonly agentId: string }[] = [
  { phrase: "local seo", agentId: "google-business-profile-agent" },
  { phrase: "google search console", agentId: "performance-analytics-agent" },
  { phrase: "core web vitals & performance", agentId: "performance-analytics-agent" },
  { phrase: "core web vitals and performance", agentId: "performance-analytics-agent" },
  { phrase: "core web vitals", agentId: "performance-analytics-agent" },
  { phrase: "link building", agentId: "off-page-seo-agent" },
  { phrase: "guest posting & outreach", agentId: "guest-posting-digital-pr-agent" },
  { phrase: "guest posting and outreach", agentId: "guest-posting-digital-pr-agent" },
  { phrase: "schema markup", agentId: "on-page-seo-agent" },
  { phrase: "structured data", agentId: "on-page-seo-agent" },
  { phrase: "proposal & sales", agentId: "business-development-agent" },
  { phrase: "proposal and sales", agentId: "business-development-agent" },
  { phrase: "client communication", agentId: "client-relationship-management-agent" },
  { phrase: "google analytics & reporting", agentId: "performance-analytics-agent" },
  { phrase: "google analytics and reporting", agentId: "performance-analytics-agent" },
  { phrase: "content refresh & optimization", agentId: "content-strategy-agent" },
  { phrase: "content refresh and optimization", agentId: "content-strategy-agent" },
  { phrase: "content refresh", agentId: "content-strategy-agent" },
];

/** Every "<phrase> Agent" mention in the task text, e.g. "the On-Page SEO Agent" -> "the On-Page SEO". Non-greedy so each mention captures only up to its own nearest "Agent". */
const AGENT_NAME_MENTION_PATTERN = /\b([a-z0-9][a-z0-9 &/'-]{2,60}?)\s+agent\b/gi;

// PRIMARY-VS-EXCLUSION FIX (2026-08-18): a real, live validation pattern --
// "Use the X Agent specifically... Do not route this request to Y Agent, Z
// Agent, ..." -- names several other real agents purely to state they must
// NOT receive the task, not as competing candidate targets. Before this fix,
// both findExplicitAgentMatch() and findUnresolvedAgentMention() read the
// whole message uniformly, so an exclusion clause's own real agent mentions
// competed with the actual primary ask and made findExplicitAgentMatch()
// bail out as falsely ambiguous (see its own "two different mentions...
// genuinely ambiguous" comment below) even though only ONE agent was ever
// actually being requested -- confirmed via live reproduction (8 explicitly
// real, registered agents all misreported as low-confidence/ambiguous
// purely because of their own message's exclusion clause).
//
// Fix: strip everything from the first recognized exclusion-clause trigger
// phrase onward BEFORE extracting any agent-name mentions, for both tiers.
// A small, disclosed set of real trigger phrasings -- not open-ended NLP,
// consistent with this codebase's existing convention (see
// boss-agent-meta-request-detector.ts's own TRIGGER_TERMS). Only text
// BEFORE the first trigger is ever considered, so:
//   - a genuinely ambiguous primary ask (two real agents both named as
//     actual targets, no exclusion framing at all) is completely
//     unaffected -- no trigger phrase means no stripping occurs;
//   - an agent mentioned ONLY inside an exclusion clause can never compete
//     with, or be selected as, the primary target;
//   - a message with no explicit "Use X Agent" framing at all (e.g. "I need
//     SEO strategy and content strategy.") is unaffected either way, since
//     no agent-name phrase exists in the first place.
const EXCLUSION_CLAUSE_TRIGGER_PATTERN = /\b(?:do\s+not\s+route(?:\s+this\s+request)?\s+to|(?:should|must|will)\s+not\s+be\s+routed\s+to|never\s+route(?:\s+this(?:\s+request)?)?\s+to)\b/i;

function stripExclusionClause(taskDescription: string): string {
  const match = EXCLUSION_CLAUSE_TRIGGER_PATTERN.exec(taskDescription);
  return match ? taskDescription.slice(0, match.index) : taskDescription;
}

function extractNamedAgentPhrases(taskDescription: string): string[] {
  const matches = [...taskDescription.matchAll(AGENT_NAME_MENTION_PATTERN)];
  return matches.map((m) => m[1]!.trim()).filter((p) => p.length > 0);
}

interface CandidateNameSet {
  readonly agentId: string;
  readonly tokens: ReadonlySet<string>;
}

function buildCandidateNameSets(registry: AgentDirectory): readonly CandidateNameSet[] {
  const sets: CandidateNameSet[] = [];
  for (const spec of registry.list()) {
    const titleTokens = significantTokens(spec.title);
    if (titleTokens.size > 0) {
      sets.push({ agentId: spec.id, tokens: titleTokens });
    }
  }
  for (const alias of ALIAS_TABLE) {
    if (!registry.has(alias.agentId)) continue; // never resolve to an id that isn't actually loaded
    const aliasTokens = significantTokens(alias.phrase);
    if (aliasTokens.size > 0) {
      sets.push({ agentId: alias.agentId, tokens: aliasTokens });
    }
  }
  return sets;
}

/**
 * Ranked by (ratio desc, then matched-token-count desc) -- a longer, more
 * specific real name (e.g. the 3-token "guest posting outreach" alias for
 * guest-posting-digital-pr-agent) must win over a shorter one that also
 * happens to reach ratio 1.0 purely because it has fewer distinctive tokens
 * to satisfy (e.g. outreach-agent's own 1-token title "Outreach",
 * satisfied by the shared word "outreach" alone) -- otherwise a narrow
 * single-word title spuriously ties with, and cancels out, a genuinely
 * better multi-token match for an unrelated real agent. Only a true tie on
 * BOTH ratio and matched count, across two DIFFERENT real agent ids, is
 * treated as ambiguous.
 */
function bestMatchFor(phraseTokens: ReadonlySet<string>, candidates: readonly CandidateNameSet[]): { agentId: string; ratio: number } | null {
  if (phraseTokens.size === 0) return null;
  let best: { agentId: string; ratio: number; matched: number } | null = null;
  let bestIsTie = false;
  for (const candidate of candidates) {
    let matched = 0;
    for (const token of candidate.tokens) {
      if (phraseTokens.has(token)) matched++;
    }
    const ratio = matched / candidate.tokens.size;
    if (ratio < MIN_MATCH_RATIO || matched === 0) continue;
    if (!best || ratio > best.ratio || (ratio === best.ratio && matched > best.matched)) {
      best = { agentId: candidate.agentId, ratio, matched };
      bestIsTie = false;
    } else if (ratio === best.ratio && matched === best.matched && candidate.agentId !== best.agentId) {
      bestIsTie = true;
    }
  }
  return bestIsTie || !best ? null : { agentId: best.agentId, ratio: best.ratio };
}

export interface ExplicitAgentMatch {
  readonly agentId: string;
  readonly matchedPhrase: string;
}

/**
 * Finds the single, unambiguous specialist agent an explicitly-named
 * mention in `taskDescription` resolves to, or `null` when no mention
 * resolves clearly, no agent is named at all, or multiple mentions resolve
 * to genuinely different agents (ambiguous -- never guessed). Real, grounded
 * agent titles from the loaded registry plus the small disclosed alias
 * table above are the only sources ever consulted -- never a fabricated
 * agent id, and never an id absent from the loaded registry.
 */
export function findExplicitAgentMatch(taskDescription: string, registry: AgentDirectory): ExplicitAgentMatch | null {
  const phrases = extractNamedAgentPhrases(stripExclusionClause(taskDescription));
  if (phrases.length === 0) return null;

  const candidates = buildCandidateNameSets(registry);
  let resolved: ExplicitAgentMatch | null = null;

  for (const phrase of phrases) {
    const match = bestMatchFor(significantTokens(phrase), candidates);
    if (!match) continue;
    if (!resolved) {
      resolved = { agentId: match.agentId, matchedPhrase: phrase };
    } else if (resolved.agentId !== match.agentId) {
      return null; // two different mentions resolved to two different real agents -- genuinely ambiguous
    }
  }

  return resolved;
}

// STRICT PRODUCTION REPAIR (2026-08-17): a real registry cross-check against
// a "canonical 27-agent" task brief found several named agents that do NOT
// exist anywhere in the real, registered roster or this file's own disclosed
// alias table -- "Programmatic SEO Agent", "E-commerce SEO Agent",
// "International SEO Agent", "AI Prompt Engineering Agent", "Automation
// Workflow Agent", "Voice Interface Agent" (see the investigation this
// change's own commit/report cites for what was actually grepped against
// Agents/*.md -- none of these appear as a title, tag, or dedicated
// capability anywhere; the closest real text is a single passing bullet,
// e.g. website-audit-agent's "Detect canonical tags, hreflang, and indexing
// directives" for "International SEO", too thin and too narrow to alias
// without silently expanding that agent's real, disclosed scope).
//
// Without this, a message that explicitly names one of these would fall
// through findExplicitAgentMatch (correctly returning null, per the "does
// not fabricate a match for genuinely ungrounded names" test) straight into
// ordinary capability/tag-weighted scoring -- exactly the keyword-hijack
// mechanism explicit-agent-match.ts's tier-0 gate was built to stop for REAL
// agents. A genuinely nonexistent agent name is even more exposed to that
// hijack, since nothing will ever out-score website-audit-agent's broad spec
// for it. This function is a second, narrower gate: it looks specifically
// for a Title-Case "<Name> Agent" mention (the pattern every one of the
// task's own missing-agent examples uses) that does NOT resolve via
// findExplicitAgentMatch's own real-title/alias matching, and reports it so
// task-router.ts can escalate honestly ("requested_agent_not_found") instead
// of silently falling through to scoring.
//
// Deliberately conservative to avoid false positives on ordinary phrasing
// that merely contains the word "agent" ("route this to the right agent"):
// requires a genuine Title-Case naming pattern (>= 2 capitalized words
// immediately before "Agent") AND >= 2 significant tokens after stopword
// filtering. Also excludes Boss Agent by name -- Boss is real, just
// structurally outside the routable specialist registry (see
// registry/agent-registry.ts's BOSS_AGENT_SPEC_ID); naming it is never a
// registry gap, Boss retains those tasks through the boss_retained/
// orchestrated paths, not this one.
// REGRESSION FIX (2026-08-17, confirmed via live reproduction): this used to
// require every repeated word in the phrase to itself START with an
// uppercase letter ([A-Z]...), which a bare "&" never does. That silently
// fragmented a real, registered agent's own ampersand-joined title --
// e.g. "Keyword & Search Intent Agent" -- into just "Search Intent Agent"
// (dropping "Keyword"), and "Guest Posting & Digital PR Agent" into just
// "Digital PR Agent" (dropping "Guest Posting"). Each shorter fragment then
// failed bestMatchFor()'s own MIN_MATCH_RATIO against the real, FULLER
// title it actually belongs to (2 of 4 real tokens = 0.5 ratio, below the
// 0.6 floor), so a message that named this real agent alongside several
// OTHER real agents (a "do not route this to X, Y, Z" anti-hijack test
// message -- which correctly makes findExplicitAgentMatch() bail out as
// ambiguous, per its own doc comment, since multiple different real agents
// were named) fell through to this tier and was wrongly reported as naming
// an agent that "doesn't exist". Fixed by letting a bare "&" stand in for
// one repetition of the word-unit, exactly like findExplicitAgentMatch's
// own, more permissive AGENT_NAME_MENTION_PATTERN already allows via its
// `[a-z0-9 &/'-]` character class -- so "Keyword & Search Intent" and
// "Guest Posting & Digital PR" are now captured whole, the same real
// grounded titles/aliases resolve correctly, and no threshold, alias table,
// or scoring logic changed.
const TITLE_CASE_AGENT_MENTION_PATTERN = /\b((?:(?:[A-Z][A-Za-z0-9'/-]*|&)\s+){1,8}[A-Z][A-Za-z0-9'/-]*)\s+Agent\b/g;

function extractTitleCaseAgentPhrases(taskDescription: string): string[] {
  const matches = [...taskDescription.matchAll(TITLE_CASE_AGENT_MENTION_PATTERN)];
  return matches.map((m) => m[1]!.trim()).filter((p) => p.length > 0);
}

export interface UnresolvedAgentMention {
  readonly matchedPhrase: string;
}

/**
 * Finds a Title-Case "<Phrase> Agent" mention that names a specific agent
 * but resolves to no real, registered agent (by title or disclosed alias).
 * Returns the first such mention, or `null` when every Title-Case mention
 * either resolves to a real agent or is too weak a signal (a single
 * significant token, or Boss Agent) to treat as a specific missing-agent
 * request.
 */
export function findUnresolvedAgentMention(
  taskDescription: string,
  registry: AgentDirectory,
  bossAgentTitle?: string,
): UnresolvedAgentMention | null {
  const phrases = extractTitleCaseAgentPhrases(stripExclusionClause(taskDescription));
  if (phrases.length === 0) return null;

  const candidates = buildCandidateNameSets(registry);
  const bossTokens = bossAgentTitle ? significantTokens(bossAgentTitle) : new Set<string>();

  for (const phrase of phrases) {
    const tokens = significantTokens(phrase);
    if (tokens.size < 2) continue;
    if (bossTokens.size > 0 && [...tokens].every((t) => bossTokens.has(t))) continue;
    const match = bestMatchFor(tokens, candidates);
    if (!match) {
      return { matchedPhrase: phrase };
    }
  }
  return null;
}
