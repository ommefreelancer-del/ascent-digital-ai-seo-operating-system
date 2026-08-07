"use client";

import * as React from "react";
import type { SpeechLanguage } from "@/lib/speech";

interface UseSpeechRecognitionOptions {
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
}

interface UseSpeechRecognitionResult {
  supported: boolean;
  listening: boolean;
  start: (lang: SpeechLanguage) => Promise<void>;
  stop: () => void;
}

function getSpeechRecognitionCtor(): typeof SpeechRecognition | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * Browser-native Speech-to-Text, standing in for the SpeechToTextProvider
 * described in docs/architecture/VoiceInterface.md. Recognized text is
 * handed back via onResult -- callers are responsible for routing it through
 * the existing Conversation & Language Manager / Boss Agent pipeline exactly
 * as typed text, per that document's "never bypass this workflow" rule.
 */
export function useSpeechRecognition({ onResult, onError }: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const [listening, setListening] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const supported = React.useMemo(() => getSpeechRecognitionCtor() !== null, []);

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = React.useCallback(
    async (lang: SpeechLanguage) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        onError?.("Speech recognition isn't supported in this browser. Try Chrome or Edge, or type your message instead.");
        return;
      }

      try {
        // Explicitly request microphone permission first so a denial produces
        // a clear, actionable error rather than a silent recognition failure.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        onError?.("Microphone permission was denied. Allow microphone access in your browser settings to use voice input.");
        return;
      }

      recognitionRef.current?.abort();
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setListening(true);
      recognition.onend = () => setListening(false);
      recognition.onerror = (event) => {
        setListening(false);
        if (event.error === "no-speech") return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          onError?.("Microphone permission was denied. Allow microphone access in your browser settings to use voice input.");
          return;
        }
        onError?.(`Speech recognition error: ${event.error}`);
      };
      recognition.onresult = (event) => {
        let transcript = "";
        let isFinal = false;
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) continue;
          transcript += result[0]?.transcript ?? "";
          if (result.isFinal) isFinal = true;
        }
        if (transcript.trim()) onResult(transcript.trim(), isFinal);
      };

      recognitionRef.current = recognition;
      recognition.start();
    },
    [onError, onResult],
  );

  React.useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  return { supported, listening, start, stop };
}
