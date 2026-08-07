"use client";

import * as React from "react";
import { pickVoiceForText } from "@/lib/speech";

interface UseSpeechSynthesisResult {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  cancel: () => void;
}

/**
 * Browser-native Text-to-Speech, standing in for the TextToSpeechProvider
 * described in docs/architecture/VoiceInterface.md. Only ever called with
 * the final, already-approved reply text produced by the existing Boss
 * Agent / specialist-agent / Claude pipeline -- it never originates content.
 */
export function useSpeechSynthesis(): UseSpeechSynthesisResult {
  const [speaking, setSpeaking] = React.useState(false);
  const voicesRef = React.useRef<SpeechSynthesisVoice[]>([]);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  React.useEffect(() => {
    if (!supported) return;
    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, [supported]);

  const cancel = React.useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = React.useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoiceForText(voicesRef.current, text);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  React.useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  return { supported, speaking, speak, cancel };
}
