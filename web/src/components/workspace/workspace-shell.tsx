"use client";

import * as React from "react";
import { AlertTriangle, Bot, History, Mic, MessageSquarePlus, Send, Sparkles, User2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import type { SpeechLanguage } from "@/lib/speech";

const TTS_STORAGE_KEY = "adasos.workspace.ttsEnabled";

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  lastMessage: string | null;
}

interface RoutingCandidate {
  agentId: string;
  agentTitle: string;
  score: number;
  matchedTerms: readonly string[];
}

interface RoutingDecision {
  taskId: string;
  status: "assigned" | "escalated" | "rejected";
  assignedAgentId?: string;
  candidates: readonly RoutingCandidate[];
  rationale: string;
  decidedAt: string;
  escalationReason?: string;
}

interface RecordedEscalation {
  id: string;
  reason: string;
  summary: string;
  candidateLabels: readonly string[];
  resolvedLabel: string | null;
  decidedAt: string;
}

interface MessageMeta {
  routingDecision: RoutingDecision | null;
  escalations: readonly RecordedEscalation[];
}

interface ChatMessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentId: string | null;
  status: string | null;
  metaJson: string | null;
  createdAt: string;
}

const statusTone: Record<string, "success" | "warning" | "destructive"> = {
  assigned: "success",
  escalated: "warning",
  rejected: "destructive",
};

function parseMeta(metaJson: string | null): MessageMeta | null {
  if (!metaJson) return null;
  try {
    return JSON.parse(metaJson) as MessageMeta;
  } catch {
    return null;
  }
}

export function WorkspaceShell() {
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = React.useState(false);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessageDTO[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [voiceLang, setVoiceLang] = React.useState<SpeechLanguage>("en-US");
  const [ttsEnabled, setTtsEnabled] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      setTtsEnabled(window.localStorage.getItem(TTS_STORAGE_KEY) === "1");
    } catch {
      // localStorage unavailable (e.g. privacy mode) -- default stays off.
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(TTS_STORAGE_KEY, ttsEnabled ? "1" : "0");
    } catch {
      // Ignore write failures; the toggle still works for this page load.
    }
  }, [ttsEnabled]);

  const loadSessions = React.useCallback(() => {
    fetch("/api/workspace/sessions")
      .then((res) => (res.ok ? res.json() : { sessions: [] }))
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => undefined)
      .finally(() => setSessionsLoaded(true));
  }, []);

  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const { speak, cancel: cancelSpeech, supported: ttsSupported } = useSpeechSynthesis();

  const { supported: sttSupported, listening, start: startListening, stop: stopListening } = useSpeechRecognition({
    onResult: (transcript) => {
      // Recognized text only fills the input box -- never auto-submitted.
      // The user must press Send (or Enter) themselves, exactly like typed text.
      setInput(transcript);
    },
    onError: (message) => setError(message),
  });

  function handleMicClick() {
    if (listening) {
      stopListening();
      return;
    }
    setError(null);
    cancelSpeech();
    startListening(voiceLang);
  }

  function toggleVoiceLang() {
    setVoiceLang((prev) => (prev === "en-US" ? "ur-PK" : "en-US"));
  }

  async function selectSession(id: string) {
    setHistoryOpen(false);
    setActiveSessionId(id);
    setError(null);
    const res = await fetch(`/api/workspace/sessions/${id}`);
    if (!res.ok) {
      setMessages([]);
      return;
    }
    const data = await res.json();
    setMessages(data.session?.messages ?? []);
  }

  function startNewChat() {
    setHistoryOpen(false);
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
  }

  async function send(overrideMessage?: string) {
    const message = (overrideMessage ?? input).trim();
    if (!message || sending) return;
    setError(null);
    setInput("");
    setSending(true);

    const optimisticUser: ChatMessageDTO = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: message,
      agentId: null,
      status: null,
      metaJson: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await fetch("/api/workspace/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId ?? undefined, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong sending that message.");
      }
      setMessages((prev) => [...prev.filter((m) => m.id !== optimisticUser.id), data.userMessage, data.assistantMessage]);
      setActiveSessionId(data.sessionId);
      loadSessions();
      if (ttsEnabled && data.assistantMessage?.content) {
        speak(data.assistantMessage.content);
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setInput(message);
      setError(err instanceof Error ? err.message : "Something went wrong sending that message.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const historyList = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button onClick={startNewChat} size="sm" className="w-full justify-start gap-2">
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
      </div>
      <ScrollArea className="flex-1 px-2 pb-3">
        {!sessionsLoaded ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading history...</p>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet. Send a message to get started.</p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSession(s.id)}
                className={cn(
                  "block w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                  activeSessionId === s.id && "bg-accent",
                )}
              >
                <p className="truncate font-medium">{s.title}</p>
                <p className="truncate text-xs text-muted-foreground">{s.lastMessage ? truncate(s.lastMessage, 42) : formatRelativeTime(s.updatedAt)}</p>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Prompt history sidebar (desktop) */}
      <aside className="hidden w-72 shrink-0 border-r border-border lg:flex">{historyList}</aside>

      {/* Mobile history dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="h-[70vh] max-w-sm p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Prompt history</DialogTitle>
            <DialogDescription>Your previous AI Workspace conversations</DialogDescription>
          </DialogHeader>
          {historyList}
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="h-3.5 w-3.5" /> History
          </Button>
          <Button variant="ghost" size="sm" onClick={startNewChat}>
            <MessageSquarePlus className="h-3.5 w-3.5" /> New
          </Button>
        </div>

        <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 lg:p-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="h-6 w-6" />
                </span>
                <h3 className="text-lg font-semibold">What do you need help with?</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Describe a task in plain language. The Boss Agent will route it to the right specialist agent out of the registry in real time.
                </p>
              </div>
            ) : (
              messages.map((message) => <ChatBubble key={message.id} message={message} />)
            )}
            {sending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="h-4 w-4 animate-pulse" /> Routing your task through the Boss Agent...
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {error ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </p>
            ) : listening ? (
              <p className="flex items-center gap-1.5 text-xs text-primary">
                <Mic className="h-3.5 w-3.5 animate-pulse" /> Listening in {voiceLang === "en-US" ? "English" : "Urdu"}... speak now.
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the AI Workspace to research keywords, audit a site, draft content..."
                className="min-h-[52px] flex-1 resize-none"
                disabled={sending}
              />
              {sttSupported ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={toggleVoiceLang}
                  disabled={listening || sending}
                  title="Voice input language"
                  className="h-[52px] w-11 shrink-0 text-xs font-semibold"
                >
                  {voiceLang === "en-US" ? "EN" : "UR"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant={listening ? "destructive" : "outline"}
                onClick={handleMicClick}
                disabled={sending || !sttSupported}
                title={
                  sttSupported
                    ? listening
                      ? "Stop listening"
                      : "Speak your message"
                    : "Speech recognition isn't supported in this browser"
                }
                size="icon"
                className="h-[52px] w-[52px] shrink-0"
              >
                <Mic className={cn("h-4 w-4", listening && "animate-pulse")} />
              </Button>
              <Button
                type="button"
                variant={ttsEnabled ? "default" : "outline"}
                onClick={() => {
                  if (ttsEnabled) cancelSpeech();
                  setTtsEnabled((prev) => !prev);
                }}
                disabled={!ttsSupported}
                title={
                  ttsSupported
                    ? ttsEnabled
                      ? "Spoken responses on -- click to disable"
                      : "Spoken responses off -- click to enable"
                    : "Text-to-speech isn't supported in this browser"
                }
                size="icon"
                className="h-[52px] w-[52px] shrink-0"
              >
                {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button onClick={() => send()} disabled={sending || !input.trim()} loading={sending} size="icon" className="h-[52px] w-[52px] shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              Messages are routed by the real Boss Agent registry -- routing decisions are shown, not simulated.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessageDTO }) {
  const isUser = message.role === "user";
  const meta = parseMeta(message.metaJson);

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {isUser ? <User2 className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-2", isUser && "items-end")}>
        <div className={cn("rounded-2xl px-4 py-2.5 text-sm", isUser ? "bg-primary text-primary-foreground" : "bg-muted")}>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {!isUser && message.status ? <TaskProgressCard status={message.status} agentId={message.agentId} meta={meta} /> : null}
      </div>
    </div>
  );
}

function TaskProgressCard({ status, agentId, meta }: { status: string; agentId: string | null; meta: MessageMeta | null }) {
  const decision = meta?.routingDecision;
  const escalations = meta?.escalations ?? [];

  return (
    <Card className="w-full max-w-sm border-border/70 bg-card/60">
      <CardContent className="space-y-2.5 p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Task progress</span>
          <Badge variant={statusTone[status] ?? "secondary"} className="capitalize">
            {status}
          </Badge>
        </div>
        {agentId ? (
          <p className="text-xs">
            Assigned to <span className="font-medium">{agentId}</span>
          </p>
        ) : null}
        {decision?.rationale ? <p className="text-xs text-muted-foreground">{decision.rationale}</p> : null}
        {decision && decision.candidates.length > 0 ? (
          <details className="text-xs">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
              {decision.candidates.length} candidate{decision.candidates.length === 1 ? "" : "s"} considered
            </summary>
            <ul className="mt-1.5 space-y-1">
              {decision.candidates.map((c) => (
                <li key={c.agentId} className="flex items-center justify-between gap-2 rounded bg-muted/60 px-2 py-1">
                  <span className="truncate">{c.agentTitle}</span>
                  <span className="shrink-0 text-muted-foreground">{Math.round(c.score * 100)}%</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {escalations.length > 0 ? (
          <details className="text-xs" open>
            <summary className="cursor-pointer select-none text-warning hover:text-warning/80">Execution log: {escalations.length} escalation(s)</summary>
            <ul className="mt-1.5 space-y-1.5">
              {escalations.map((e) => (
                <li key={e.id} className="rounded bg-warning/10 px-2 py-1.5">
                  <p className="font-medium text-warning">{e.reason.replace(/_/g, " ")}</p>
                  <p className="text-muted-foreground">{e.summary}</p>
                  <p className="text-muted-foreground">
                    {e.resolvedLabel ? `Auto-resolved to "${e.resolvedLabel}"` : "No candidate was available to auto-resolve."}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
