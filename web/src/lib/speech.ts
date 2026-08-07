/**
 * Shared helpers for the browser-native voice layer described in
 * docs/architecture/VoiceInterface.md. These only decide which recognition
 * language/voice to use client-side -- they never touch routing, scoring,
 * or the Boss Agent pipeline.
 */

// Urdu (and Arabic-script text generally) falls in the Arabic Unicode block.
const ARABIC_SCRIPT_RE = /[؀-ۿ]/;

export type SpeechLanguage = "en-US" | "ur-PK";

export function detectScriptLanguage(text: string): "ur" | "en" {
  return ARABIC_SCRIPT_RE.test(text) ? "ur" : "en";
}

export function pickVoiceForText(voices: SpeechSynthesisVoice[], text: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const wantsUrdu = detectScriptLanguage(text) === "ur";
  const prefix = wantsUrdu ? "ur" : "en";
  const exact = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  if (exact) return exact;
  // Urdu voices are rare in desktop browsers -- fall back to any English
  // voice so audio is still produced instead of silently doing nothing.
  if (wantsUrdu) {
    return voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? voices[0] ?? null;
  }
  return voices[0] ?? null;
}
