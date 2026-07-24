// Tiny shared text helper, matching the one in
// src/agents/content-strategy-agent/util/capitalize.ts. Duplicated rather
// than imported cross-agent to keep each agent module self-contained (see
// dispatch.ts files across agents for the same principle applied to
// Boss Agent integration).
export function capitalize(text: string): string {
  return text.replace(/\b\w/g, (character) => character.toUpperCase());
}
