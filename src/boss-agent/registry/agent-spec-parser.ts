// Parses the markdown format used by Agents/*.md into a structured
// AgentSpec. The format (observed consistently across every existing spec
// file) is:
//
//   # <Title>
//
//   ## Mission
//   <paragraph>
//
//   ## Responsibilities
//   - item
//   - item
//
//   ## Communicates With
//   Receives: A, B
//
//   Sends: C, D
//
//   ## Tools / ## Rules / ## Success Criteria
//   - item
//
// Title, Mission, and Responsibilities are treated as mandatory: a spec that
// is missing any of them cannot be meaningfully routed to, and Engineering
// Standards SS12 (Data Integrity) calls for reporting inconsistencies rather
// than silently guessing around them. Every other section is optional and
// defaults to an empty list, since some existing specs omit sections such as
// "Success Criteria".

import { basename } from "node:path";
import { AgentSpecParseError, type AgentCommunication, type AgentSpec } from "../types/agent-spec.types.js";

const TITLE_PATTERN = /^#\s+(.+?)\s*$/;
const SECTION_PATTERN = /^##\s+(.+?)\s*$/;
const BULLET_PATTERN = /^-\s+(.+?)\s*$/;
const RECEIVES_PATTERN = /^Receives:\s*(.*)$/i;
const SENDS_PATTERN = /^Sends:\s*(.*)$/i;

interface RawSpec {
  // Explicitly `string | undefined` (rather than an optional `title?`)
  // because this is always assigned, possibly with `undefined`, when
  // extractSections() builds the result -- exactOptionalPropertyTypes
  // distinguishes "assigned undefined" from "key omitted".
  title: string | undefined;
  sections: Map<string, string[]>;
}

/** Derives a stable id such as "keyword-research-agent" from its file name. */
export function deriveAgentId(sourcePath: string): string {
  return basename(sourcePath).replace(/\.md$/i, "").trim().toLowerCase().replace(/\s+/g, "-");
}

/** Parses raw markdown content into an AgentSpec, or throws AgentSpecParseError. */
export function parseAgentSpec(sourcePath: string, content: string): AgentSpec {
  const raw = extractSections(content);

  if (!raw.title) {
    throw new AgentSpecParseError(sourcePath, "missing a top-level '# Title' heading.");
  }

  const mission = joinParagraph(raw.sections.get("mission") ?? []);
  if (!mission) {
    throw new AgentSpecParseError(sourcePath, "missing a non-empty '## Mission' section.");
  }

  const responsibilities = toBulletList(raw.sections.get("responsibilities") ?? []);
  if (responsibilities.length === 0) {
    throw new AgentSpecParseError(sourcePath, "missing a non-empty '## Responsibilities' section.");
  }

  return {
    id: deriveAgentId(sourcePath),
    sourcePath,
    title: raw.title,
    mission,
    responsibilities,
    inputs: toBulletList(raw.sections.get("inputs") ?? []),
    outputs: toBulletList(raw.sections.get("outputs") ?? []),
    communicatesWith: parseCommunication(raw.sections.get("communicates with") ?? []),
    tools: toBulletList(raw.sections.get("tools") ?? []),
    rules: toBulletList(raw.sections.get("rules") ?? []),
    successCriteria: toBulletList(raw.sections.get("success criteria") ?? []),
  };
}

/**
 * Reads a regex capture group that the calling pattern guarantees is
 * present whenever the overall match succeeds (none of our patterns place
 * the sole capture group inside an optional quantifier). Throwing instead of
 * silently defaulting keeps a future regex edit that breaks this invariant
 * from failing silently.
 */
function requireGroup(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`Internal error: expected regex capture group ${index} to be present.`);
  }
  return value;
}

function extractSections(content: string): RawSpec {
  const lines = content.split(/\r\n|\r|\n/);
  const sections = new Map<string, string[]>();
  let title: string | undefined;
  let currentKey: string | undefined;

  for (const line of lines) {
    const titleMatch = TITLE_PATTERN.exec(line);
    if (titleMatch && !title) {
      title = requireGroup(titleMatch, 1);
      continue;
    }

    const sectionMatch = SECTION_PATTERN.exec(line);
    if (sectionMatch) {
      currentKey = requireGroup(sectionMatch, 1).trim().toLowerCase();
      if (!sections.has(currentKey)) {
        sections.set(currentKey, []);
      }
      continue;
    }

    if (currentKey) {
      sections.get(currentKey)!.push(line);
    }
  }

  return { title, sections };
}

function toBulletList(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const match = BULLET_PATTERN.exec(line);
    if (match) {
      items.push(requireGroup(match, 1));
    }
  }
  return items;
}

function joinParagraph(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

function parseCommunication(lines: string[]): AgentCommunication {
  let receives: string[] = [];
  let sends: string[] = [];

  for (const line of lines) {
    const receivesMatch = RECEIVES_PATTERN.exec(line.trim());
    if (receivesMatch) {
      receives = splitNames(requireGroup(receivesMatch, 1));
      continue;
    }
    const sendsMatch = SENDS_PATTERN.exec(line.trim());
    if (sendsMatch) {
      sends = splitNames(requireGroup(sendsMatch, 1));
    }
  }

  return { receives, sends };
}

function splitNames(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}
