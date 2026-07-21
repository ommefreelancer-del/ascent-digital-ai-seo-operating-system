import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRegistry, BOSS_AGENT_SPEC_ID } from "../../../src/boss-agent/registry/agent-registry.js";

const KEYWORD_AGENT = `# Keyword Research Agent

## Mission
Identify high-value keywords.

## Responsibilities
- Perform keyword research.

## Inputs
- Business objectives

## Outputs
- Keyword report

## Communicates With
Receives: Boss Agent

Sends: SEO Strategy Agent

## Tools
- Ahrefs

## Rules
- Follow GLOBAL_RULES.md.
`;

const CONTENT_AGENT = `# Content Strategy Agent

## Mission
Plan content that supports SEO goals.

## Responsibilities
- Plan editorial calendars.

## Inputs
- Keyword report

## Outputs
- Content plan

## Communicates With
Receives: Boss Agent

Sends: SEO Content Agent

## Tools
- Google Docs

## Rules
- Follow GLOBAL_RULES.md.
`;

const BOSS_AGENT = `
# Boss Agent

## Mission
Coordinate the entire SEO workflow.

## Responsibilities
- Assign tasks to specialist agents.

## Inputs
- Client requirements

## Outputs
- Task assignments

## Communicates With
Receives: User, All Specialist Agents

Sends: All Specialist Agents, User

## Tools
- Internal workflows

## Rules
- Follow GLOBAL_RULES.md.
`;

async function writeFixture(dir: string, fileName: string, content: string): Promise<void> {
  await writeFile(join(dir, fileName), content, "utf8");
}

describe("AgentRegistry", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "boss-agent-registry-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads every specialist agent spec and excludes the Boss Agent's own spec by default", async () => {
    await writeFixture(dir, "keyword-research-agent.md", KEYWORD_AGENT);
    await writeFixture(dir, "content-strategy-agent.md", CONTENT_AGENT);
    await writeFixture(dir, "BossAgent.md", BOSS_AGENT);

    const registry = await AgentRegistry.load(dir);

    expect(registry.size()).toBe(2);
    expect(registry.has("keyword-research-agent")).toBe(true);
    expect(registry.has("content-strategy-agent")).toBe(true);
    expect(registry.has(BOSS_AGENT_SPEC_ID)).toBe(false);
  });

  it("returns AgentSpec objects with the expected fields via getById/list", async () => {
    await writeFixture(dir, "keyword-research-agent.md", KEYWORD_AGENT);

    const registry = await AgentRegistry.load(dir);
    const spec = registry.getById("keyword-research-agent");

    expect(spec?.title).toBe("Keyword Research Agent");
    expect(registry.list()).toHaveLength(1);
  });

  it("throws when the directory contains no markdown files", async () => {
    await expect(AgentRegistry.load(dir)).rejects.toThrow(/No agent spec files/);
  });

  it("throws when only the Boss Agent's own spec is present", async () => {
    await writeFixture(dir, "BossAgent.md", BOSS_AGENT);

    await expect(AgentRegistry.load(dir)).rejects.toThrow(/no routable specialist agents/);
  });

  it("throws when two different file names derive the same agent id", async () => {
    await writeFixture(dir, "keyword-research-agent.md", KEYWORD_AGENT);
    await writeFixture(dir, "Keyword Research-agent.md", KEYWORD_AGENT);

    await expect(AgentRegistry.load(dir)).rejects.toThrow(/Duplicate agent id/);
  });

  it("fails the entire load if one spec file is malformed", async () => {
    await writeFixture(dir, "keyword-research-agent.md", KEYWORD_AGENT);
    await writeFixture(dir, "broken-agent.md", "# Broken Agent\n\nNo sections here.\n");

    await expect(AgentRegistry.load(dir)).rejects.toThrow();
  });
});
