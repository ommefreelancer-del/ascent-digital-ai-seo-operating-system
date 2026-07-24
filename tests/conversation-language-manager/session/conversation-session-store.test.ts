import { describe, expect, it } from "vitest";
import { InMemoryConversationSessionStore } from "../../../src/conversation-language-manager/session/conversation-session-store.js";

describe("InMemoryConversationSessionStore", () => {
  it("creates a new session on first access, defaulting to English with empty history", () => {
    const store = new InMemoryConversationSessionStore();
    const session = store.getOrCreate("session-1");
    expect(session).toEqual({ sessionId: "session-1", language: "en", history: [] });
  });

  it("returns the same session on repeated access", () => {
    const store = new InMemoryConversationSessionStore();
    store.appendTurn("session-1", { role: "user", text: "hi", occurredAt: "2026-07-01T00:00:00.000Z" });
    expect(store.getOrCreate("session-1").history).toHaveLength(1);
  });

  it("updates the real language for a session", () => {
    const store = new InMemoryConversationSessionStore();
    store.setLanguage("session-1", "ur");
    expect(store.get("session-1")?.language).toBe("ur");
  });

  it("appends turns in order", () => {
    const store = new InMemoryConversationSessionStore();
    store.appendTurn("session-1", { role: "user", text: "hi", occurredAt: "2026-07-01T00:00:00.000Z" });
    store.appendTurn("session-1", { role: "assistant", text: "hello", occurredAt: "2026-07-01T00:00:01.000Z" });
    expect(store.get("session-1")?.history.map((t) => t.text)).toEqual(["hi", "hello"]);
  });

  it("returns undefined for a session that was never created", () => {
    const store = new InMemoryConversationSessionStore();
    expect(store.get("never-seen")).toBeUndefined();
  });

  it("keeps sessions independent of each other", () => {
    const store = new InMemoryConversationSessionStore();
    store.setLanguage("session-a", "ur");
    store.setLanguage("session-b", "en");
    expect(store.get("session-a")?.language).toBe("ur");
    expect(store.get("session-b")?.language).toBe("en");
  });
});
