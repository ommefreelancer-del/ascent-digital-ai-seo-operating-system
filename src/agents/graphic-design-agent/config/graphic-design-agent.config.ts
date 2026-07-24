// Configuration for the Graphic Design Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullImageGenerationProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface GraphicDesignAgentConfig {
  readonly auditLogPath: string;
}

export type GraphicDesignAgentConfigOverrides = Partial<GraphicDesignAgentConfig>;

export function loadGraphicDesignAgentConfig(
  overrides: GraphicDesignAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): GraphicDesignAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["GRAPHIC_DESIGN_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "graphic-design-agent", "audit-log.jsonl"),
  };
}
