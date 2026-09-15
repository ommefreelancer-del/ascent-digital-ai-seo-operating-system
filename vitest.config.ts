import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default discovery has no config to scope it, so it was
    // reaching into web/tests/** too (web/ has its own separate npm test,
    // run in a different CI job with working-directory: web) -- picked up
    // web's own test files without web's vitest.config.ts (its @ alias,
    // etc.), silently double-running some and failing others that need it.
    // Scoped to match tsconfig.json's own top-level "include": ["src", "tests"].
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
