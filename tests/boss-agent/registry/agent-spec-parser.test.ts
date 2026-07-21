import { describe, expect, it } from "vitest";
import {
  deriveAgentId,
  parseAgentSpec,
} from "../../../src/boss-agent/registry/agent-spec-parser.js";
import { AgentSpecParseError } from "../../../src/boss-agent/types/agent-spec.types.js";

const FULL_SPEC = `# Keyword Research & Search Intent Agent

## Mission
Identify high-value keywords and accurately analyze user search intent to
support SEO strategy, content planning, and organic growth.

## Responsibilities
- Perform comprehensive keyword research.
- Analyze search intent.

## Inputs
- Business objectives
- Target audience

## Outputs
- Keyword Research Report
- Topic Clusters

## Communicates With
Receives: Boss Agent, Competitor Intelligence Agent

Sends: SEO Strategy Agent, Content Strategy Agent

## Tools
- Ahrefs
- SEMrush

## Rules
- Follow GLOBAL_RULES.md.
- Never fabricate keyword metrics.

## Success Criteria
- High-value keywords are identified.
`;

describe("parseAgentSpec", () => {
  it("parses every section of a well-formed spec", () => {
    const spec = parseAgentSpec("/Agents/keyword-research-agent.md", FULL_SPEC);

    expect(spec.id).toBe("keyword-research-agent");
    expect(spec.title).toBe("Keyword Research & Search Intent Agent");
    expect(spec.mission).toContain("Identify high-value keywords");
    expect(spec.responsibilities).toEqual([
      "Perform comprehensive keyword research.",
      "Analyze search intent.",
    ]);
    expect(spec.inputs).toEqual(["Business objectives", "Target audience"]);
    expect(spec.outputs).toEqual(["Keyword Research Report", "Topic Clusters"]);
    expect(spec.communicatesWith).toEqual({
      receives: ["Boss Agent", "Competitor Intelligence Agent"],
      sends: ["SEO Strategy Agent", "Content Strategy Agent"],
    });
    expect(spec.tools).toEqual(["Ahrefs", "SEMrush"]);
    expect(spec.rules).toEqual(["Follow GLOBAL_RULES.md.", "Never fabricate keyword metrics."]);
    expect(spec.successCriteria).toEqual(["High-value keywords are identified."]);
  });

  it("defaults an omitted optional section to an empty list", () => {
    const withoutSuccessCriteria = FULL_SPEC.replace(
      /## Success Criteria\n- High-value keywords are identified\.\n/,
      "",
    );

    const spec = parseAgentSpec("/Agents/keyword-research-agent.md", withoutSuccessCriteria);

    expect(spec.successCriteria).toEqual([]);
    // Every other section is unaffected.
    expect(spec.responsibilities.length).toBeGreaterThan(0);
  });

  it("throws AgentSpecParseError when the title heading is missing", () => {
    const withoutTitle = FULL_SPEC.replace("# Keyword Research & Search Intent Agent\n\n", "");

    expect(() => parseAgentSpec("/Agents/broken.md", withoutTitle)).toThrow(AgentSpecParseError);
  });

  it("throws AgentSpecParseError when the Mission section is missing", () => {
    const withoutMission = FULL_SPEC.replace(
      /## Mission\nIdentify high-value keywords and accurately analyze user search intent to\nsupport SEO strategy, content planning, and organic growth\.\n\n/,
      "",
    );

    expect(() => parseAgentSpec("/Agents/broken.md", withoutMission)).toThrow(AgentSpecParseError);
  });

  it("throws AgentSpecParseError when Responsibilities has no bullet items", () => {
    const emptyResponsibilities = FULL_SPEC.replace(
      "## Responsibilities\n- Perform comprehensive keyword research.\n- Analyze search intent.\n",
      "## Responsibilities\n",
    );

    expect(() => parseAgentSpec("/Agents/broken.md", emptyResponsibilities)).toThrow(
      AgentSpecParseError,
    );
  });

  it("handles a spec with a leading blank line before the title (as in BossAgent.md)", () => {
    const spec = parseAgentSpec("/Agents/BossAgent.md", `\n${FULL_SPEC}`);
    expect(spec.title).toBe("Keyword Research & Search Intent Agent");
  });

  it("tolerates CRLF line endings", () => {
    const crlfSpec = FULL_SPEC.replace(/\n/g, "\r\n");
    const spec = parseAgentSpec("/Agents/keyword-research-agent.md", crlfSpec);
    expect(spec.responsibilities).toEqual([
      "Perform comprehensive keyword research.",
      "Analyze search intent.",
    ]);
  });
});

describe("deriveAgentId", () => {
  it("lowercases and hyphenates a file name with spaces", () => {
    expect(deriveAgentId("/Agents/SEO Strategy Agent.md")).toBe("seo-strategy-agent");
  });

  it("leaves an already-hyphenated file name unchanged (aside from casing)", () => {
    expect(deriveAgentId("/Agents/keyword-research-agent.md")).toBe("keyword-research-agent");
  });

  it("derives the reserved Boss Agent id from BossAgent.md", () => {
    expect(deriveAgentId("/Agents/BossAgent.md")).toBe("bossagent");
  });
});
