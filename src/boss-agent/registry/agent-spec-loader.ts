// Reads the raw contents of every specialist agent spec file from disk.
// Deliberately does no parsing itself (single responsibility): it only knows
// how to find and read files, leaving interpretation to agent-spec-parser.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface RawAgentSpecFile {
  readonly sourcePath: string;
  readonly content: string;
}

/**
 * Reads every `.md` file directly inside `agentsDirectory`. Sub-directories
 * are not traversed, matching the flat layout of the existing Agents/ folder.
 */
export async function loadRawAgentSpecFiles(agentsDirectory: string): Promise<RawAgentSpecFile[]> {
  const entries = await readdir(agentsDirectory, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => join(agentsDirectory, entry.name));

  return Promise.all(
    markdownFiles.map(async (sourcePath) => ({
      sourcePath,
      content: await readFile(sourcePath, "utf8"),
    })),
  );
}
