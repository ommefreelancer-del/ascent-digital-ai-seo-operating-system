// Maintains real conversation context/history per session -- per the
// architecture doc's "Session Management" and "Context Management"
// responsibilities ("Maintain active session context", "Preserve
// conversation history throughout the active session"). This is local,
// in-process session state, not an external system read/write (unlike the
// pluggable providers used elsewhere in this codebase for real third-party
// data) -- so there is no "real vs fabricated" concern here, and no Null
// implementation is needed. The interface exists so a future durable store
// (e.g. backed by TaskStateStore's JSON-file pattern) can be swapped in
// without changing ConversationLanguageManager, per the architecture doc's
// "Future Expansion" section.

import type { ConversationSession, ConversationTurn, SupportedLanguage } from "../types/conversation.types.js";

export interface ConversationSessionStore {
  getOrCreate(sessionId: string): ConversationSession;
  get(sessionId: string): ConversationSession | undefined;
  setLanguage(sessionId: string, language: SupportedLanguage): void;
  appendTurn(sessionId: string, turn: ConversationTurn): void;
}

export class InMemoryConversationSessionStore implements ConversationSessionStore {
  private readonly sessions = new Map<string, ConversationSession>();

  getOrCreate(sessionId: string): ConversationSession {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const created: ConversationSession = { sessionId, language: "en", history: [] };
    this.sessions.set(sessionId, created);
    return created;
  }

  get(sessionId: string): ConversationSession | undefined {
    return this.sessions.get(sessionId);
  }

  setLanguage(sessionId: string, language: SupportedLanguage): void {
    const session = this.getOrCreate(sessionId);
    this.sessions.set(sessionId, { ...session, language });
  }

  appendTurn(sessionId: string, turn: ConversationTurn): void {
    const session = this.getOrCreate(sessionId);
    this.sessions.set(sessionId, { ...session, history: [...session.history, turn] });
  }
}
