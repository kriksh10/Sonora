import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  CircleStop,
  Clock3,
  FileText,
  LogOut,
  Mic,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { useClerk, useUser } from "@clerk/react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import DesktopToolbar from "@/components/desktop-toolbar";
import { createDesktopAudio, type AudioCapture } from "@/lib/desktop-audio";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type SpeechResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

type NewSessionForm = {
  sessionType: "interview" | "call";
  company: string;
  description: string;
  title: string;
  resumeText: string;
  documentsText: string;
  instructions: string;
  answerPreference: "concise" | "detailed" | "technical";
  model: "gemini-2.5-flash" | "gemini-3-flash-preview";
  language: string;
  autoAnswer: boolean;
  saveTranscript: boolean;
};

const emptyForm: NewSessionForm = {
  sessionType: "interview",
  company: "",
  description: "",
  title: "",
  resumeText: "",
  documentsText: "",
  instructions: "",
  answerPreference: "concise",
  model: "gemini-2.5-flash",
  language: "English",
  autoAnswer: false,
  saveTranscript: true,
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload as T;
}

async function extractFileText(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024) {
    throw new Error(`${file.name} is larger than the 12 MB limit.`);
  }
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    return file.text();
  }
  if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
    const pdf = await getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .filter(Boolean)
          .join(" "),
      );
    }
    return pages.join("\n").slice(0, 40_000);
  }
  throw new Error("Choose a PDF, TXT, or Markdown file.");
}

function formatDuration(startedAt: string | null, now: number) {
  if (!startedAt) return "00:00";
  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}

function isLikelyQuestion(text: string) {
  return (
    text.includes("?") ||
    /^(what|how|why|when|where|which|who|can you|could you|would you|tell me|describe|explain|walk me|give me|write|implement|design)\b/i.test(
      text.trim(),
    )
  );
}

export default function InterviewWorkspace() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "ended">("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<NewSessionForm>(emptyForm);
  const [answerInput, setAnswerInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [uploading, setUploading] = useState<"resume" | "documents" | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const desktopCaptureRef = useRef<AudioCapture | null>(null);
  const [audioSource, setAudioSource] = useState<"microphone" | "system">("microphone");
  const [compact, setCompact] = useState(Boolean(window.sonoraDesktop));
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<"resume" | "documents">("resume");
  const answerInFlightRef = useRef(false);
  const captureTokenRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const visibleAnswer = busy
    ? ""
    : answer ||
      [...(selected?.transcript ?? [])].reverse().find((entry) => entry.role === "assistant")?.text ||
      "";

  const refreshSessions = useCallback(async () => {
    try {
      const data = await api<CallSession[]>("/sessions");
      setSessions(data);
      setSelectedId((current) =>
        current && data.some((item) => item.id === current)
          ? current
          : data[0]?.id ?? null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const saveTranscript = useCallback(
    async (
      session: CallSession,
      role: "user" | "assistant",
      text: string,
      source: TranscriptEntry["source"],
    ) => {
      const entry: TranscriptEntry = {
        role,
        text,
        source,
        createdAt: new Date().toISOString(),
      };
      if (session.saveTranscript) {
        const updated = await api<CallSession>(
          `/sessions/${session.id}/transcript`,
          {
            method: "POST",
            body: JSON.stringify({ role, text, source }),
          },
        );
        setSessions((items) =>
          items.map((item) => (item.id === session.id ? updated : item)),
        );
      } else {
        setSessions((items) =>
          items.map((item) =>
            item.id === session.id
              ? { ...item, transcript: [...item.transcript, entry] }
              : item,
          ),
        );
      }
    },
    [],
  );

  const askGemini = useCallback(
    async (question: string, source: "typed" | "microphone" = "typed") => {
      if (!selected) return;
      const cleanQuestion = question.trim();
      if (!cleanQuestion) return;
      if (answerInFlightRef.current) return;
      answerInFlightRef.current = true;
      setBusy(true);
      setError("");
      setAnswer("");
      try {
        await saveTranscript(selected, "user", cleanQuestion, source);
        const response = await api<{ answer: string; model: string }>(
          `/sessions/${selected.id}/answer`,
          {
            method: "POST",
            body: JSON.stringify({ question: cleanQuestion }),
          },
        );
        if (selectedIdRef.current === selected.id) setAnswer(response.answer);
        if (selected.saveTranscript) {
          await refreshSessions();
        } else {
          const entry: TranscriptEntry = {
            role: "assistant",
            text: response.answer,
            source: "ai",
            createdAt: new Date().toISOString(),
          };
          setSessions((items) =>
            items.map((item) =>
              item.id === selected.id
                ? { ...item, transcript: [...item.transcript, entry] }
                : item,
            ),
          );
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Gemini could not answer.");
      } finally {
        answerInFlightRef.current = false;
        setBusy(false);
      }
    },
    [refreshSessions, saveTranscript, selected],
  );
  const askRef = useRef(askGemini);
  askRef.current = askGemini;

  const stopCapture = useCallback(() => {
    captureTokenRef.current += 1;
    desktopCaptureRef.current?.stop();
    desktopCaptureRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setListening(false);
    setRequestingMic(false);
    setInterimTranscript("");
  }, []);

  useEffect(() => {
    const off = window.sonoraDesktop?.onStopCapture(stopCapture);
    window.addEventListener("beforeunload", stopCapture);
    return () => { off?.(); window.removeEventListener("beforeunload", stopCapture); };
  }, [stopCapture]);

  useEffect(() => {
    setListening(false);
    setRequestingMic(false);
    setInterimTranscript("");
    return () => {
      stopCapture();
    };
  }, [selectedId, stopCapture]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await api<CallSession>("/sessions", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          title: form.title,
          company: form.company,
        }),
      });
      setSessions((items) => [created, ...items]);
      setSelectedId(created.id);
      setCreateOpen(false);
      setAnswer("");
      setForm(emptyForm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create session.");
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const target = uploadTargetRef.current;
    setUploading(target);
    setError("");
    try {
      const texts = await Promise.all(files.map(extractFileText));
      const joined = texts.join("\n\n").slice(0, 40_000);
      if (!joined.trim()) {
        throw new Error("No selectable text was found. Paste the resume or document text below instead.");
      }
      setForm((current) => ({
        ...current,
        [target === "resume" ? "resumeText" : "documentsText"]:
          target === "resume"
            ? joined
            : [current.documentsText, joined].filter(Boolean).join("\n\n").slice(0, 40_000),
      }));
      setNotice(`${files.length} file${files.length > 1 ? "s" : ""} added as text context.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that file.");
    } finally {
      setUploading(null);
    }
  };

  const startSession = async () => {
    if (!selected) return;
    await toggleMicrophone();
  };

  const endSession = async () => {
    if (!selected) return;
    stopCapture();
    try {
      const updated = await api<CallSession>(`/sessions/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ended" }),
      });
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("Session ended. Its transcript is saved if Save Transcript was enabled.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end the session.");
    }
  };

  const toggleMicrophone = async () => {
    if (!selected) return;
    if (listening || requestingMic) {
      stopCapture();
      setNotice("Audio transcription stopped. Any incomplete final chunk was discarded.");
      return;
    }
    if (selected.status === "ended") {
      setError("This session has ended. Create a new session to start microphone transcription.");
      return;
    }
    if (window.sonoraDesktop) {
      const captureToken = ++captureTokenRef.current;
      setRequestingMic(true);
      setError("");
      const capture = createDesktopAudio({
        source: audioSource,
        sessionId: selected.id,
        onText: text => {
          if (captureToken !== captureTokenRef.current) return;
          if (selected.autoAnswer && isLikelyQuestion(text) && !answerInFlightRef.current) {
            void askRef.current(text, "microphone");
          } else {
            void saveTranscript(selected, "user", text, "microphone").catch(cause =>
              setError(cause instanceof Error ? cause.message : "Could not save transcript."));
          }
        },
        onNotice: text => { if (captureToken === captureTokenRef.current) setNotice(text); },
        onError: cause => {
          if (captureToken !== captureTokenRef.current) return;
          stopCapture();
          setError(cause.message);
        },
      });
      desktopCaptureRef.current = capture;
      try {
        await capture.start();
        if (captureToken !== captureTokenRef.current) { capture.stop(); return; }
        if (selected.status === "ready") {
          const updated = await api<CallSession>(`/sessions/${selected.id}`, {
            method: "PATCH", body: JSON.stringify({ status: "active" }),
          });
          setSessions(items => items.map(item => item.id === updated.id ? updated : item));
        }
        if (captureToken !== captureTokenRef.current) { capture.stop(); return; }
        setListening(true);
        setNotice(`${audioSource === "system" ? "System audio" : "Microphone"} is on. Short audio chunks are sent to Gemini for transcription. Processing delay is expected; Stop is also available from the tray.`);
      } catch (cause) {
        if (captureToken !== captureTokenRef.current) return;
        stopCapture();
        setError(cause instanceof Error ? cause.message : "Could not start desktop audio.");
      } finally {
        if (captureToken === captureTokenRef.current) setRequestingMic(false);
      }
      return;
    }
    const speechWindow = window as WindowWithSpeechRecognition;
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Live speech-to-text is not supported in this browser. You can still type a question below and test Gemini.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot request microphone access. Type a question below to test Gemini.");
      return;
    }
    const captureToken = ++captureTokenRef.current;
    setRequestingMic(true);
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (captureToken !== captureTokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang =
        selected?.language === "Spanish"
          ? "es-ES"
          : selected?.language === "French"
            ? "fr-FR"
            : selected?.language === "German"
              ? "de-DE"
              : "en-US";
      recognition.onresult = (event) => {
        if (captureToken !== captureTokenRef.current) return;
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = event.results[index][0]?.transcript?.trim() ?? "";
          if (!text) continue;
          if (event.results[index].isFinal) {
            const activeSession = sessions.find((item) => item.id === selectedId);
            if (activeSession) {
              if (activeSession.autoAnswer && isLikelyQuestion(text) && !answerInFlightRef.current) {
                void askRef.current(text, "microphone");
              } else {
                void saveTranscript(activeSession, "user", text, "microphone").catch(
                  (cause) =>
                    setError(cause instanceof Error ? cause.message : "Could not save transcript."),
                );
              }
            }
          } else {
            interim += `${text} `;
          }
        }
        setInterimTranscript(interim.trim());
      };
      recognition.onerror = (event) => {
        stream.getTracks().forEach((track) => track.stop());
        if (captureToken !== captureTokenRef.current) return;
        setError(
          event.error === "not-allowed"
            ? "Microphone permission was denied. Allow microphone access in your browser settings and try again."
            : `Speech recognition stopped (${event.error}). You can still type a question.`,
        );
        setListening(false);
        streamRef.current = null;
      };
      recognition.onend = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (captureToken !== captureTokenRef.current) return;
        setListening(false);
        setInterimTranscript("");
        streamRef.current = null;
      };
      recognitionRef.current = recognition;
      if (selected.status === "ready") {
        const updated = await api<CallSession>(`/sessions/${selected.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "active" }),
        });
        setSessions((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      if (captureToken !== captureTokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      recognition.start();
      setListening(true);
      setNotice("Microphone is on. Your browser’s speech recognition service is transcribing it.");
    } catch (cause) {
      if (captureToken !== captureTokenRef.current) return;
      recognitionRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setListening(false);
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser settings."
          : cause instanceof Error
            ? cause.message
            : "Could not start microphone transcription.",
      );
    } finally {
      if (captureToken === captureTokenRef.current) setRequestingMic(false);
    }
  };

  const visibleSessions = sessions.filter((session) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && session.status === "active") ||
      (filter === "ended" && session.status === "ended");
    return (
      matchesFilter &&
      `${session.title} ${session.company ?? ""} ${session.description ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });

  return (
    <main className="min-h-screen bg-[#101113] text-[#e7e8eb]">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
        multiple
        className="hidden"
        onChange={handleUpload}
      />
      <header className={`${window.sonoraDesktop ? "desktop-drag" : ""} flex h-[60px] items-center justify-between border-b border-white/10 bg-[#17181b] px-4 sm:px-6`}>
        <a href={import.meta.env.BASE_URL} className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#75c853] text-[#19321d]"><Sparkles size={18} /></span>
          Sonora <span className="text-xs font-medium text-white/50">AI</span>
        </a>
        <div className="flex items-center gap-3 text-sm text-white/65">
          <span className="hidden sm:inline">{user?.primaryEmailAddress?.emailAddress}</span>
          {!window.sonoraDesktop && <a href={`${import.meta.env.BASE_URL}download`} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5">Desktop downloads</a>}
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
            onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
          >
            <LogOut size={15} /> <span className="hidden sm:inline">Log out</span>
          </button>
          {window.sonoraDesktop && <button onClick={() => void window.sonoraDesktop?.hide()} aria-label="Hide desktop assistant" className="rounded-lg p-2 hover:bg-white/5"><X size={17} /></button>}
        </div>
      </header>

      <div className={`mx-auto max-w-[1440px] px-4 ${compact ? "py-3" : "py-6 sm:px-6 lg:px-8"}`}>
        <DesktopToolbar captureActive={listening} onStop={stopCapture} />
        {window.sonoraDesktop && <div className="mb-4 flex flex-wrap gap-2">
          <select aria-label="Current desktop session" value={selectedId ?? ""} onChange={event => { setSelectedId(event.target.value || null); setAnswer(""); setError(""); }} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#17181b] px-3 py-2 text-sm"><option value="">Choose a session</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select>
          <button onClick={() => setCompact(value => !value)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">{compact ? "Show session browser" : "Compact assistant"}</button>
        </div>}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[.14em] text-white/40">Workspace</div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Call Sessions</h1>
            <p className="mt-1 text-sm text-white/55">Prepare for interviews and get answer suggestions while you talk.</p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-[#257c3c] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#2c9147]"
            onClick={() => {
              setError("");
              setNotice("");
              setForm(emptyForm);
              setCreateOpen(true);
            }}
          >
            <Plus size={17} /> Create Session
          </button>
        </div>

        {(error || notice) && (
          <div className={`mb-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-400/25 bg-red-500/10 text-red-200" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"}`}>
            <span>{error || notice}</span>
            <button aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}><X size={16} /></button>
          </div>
        )}

        <div className={`grid min-h-[600px] gap-5 ${compact ? "" : "lg:grid-cols-[300px_minmax(0,1fr)]"}`}>
          <aside className={`${compact ? "hidden" : "flex"} flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#17181b]`}>
            <div className="border-b border-white/10 p-4">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search sessions"
                  aria-label="Search sessions"
                  className="w-full rounded-lg border border-white/10 bg-[#101113] py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-white/35 focus:border-white/25"
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-[#101113] p-1 text-xs">
                {(["all", "active", "ended"] as const).map((item) => (
                  <button key={item} className={`rounded-md px-2 py-1.5 capitalize ${filter === item ? "bg-[#2b2d31] text-white" : "text-white/45 hover:text-white/75"}`} onClick={() => setFilter(item)}>{item}</button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <p className="p-4 text-sm text-white/45">Loading your sessions…</p>
              ) : visibleSessions.length ? (
                visibleSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => { setSelectedId(session.id); setAnswer(""); setError(""); }}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedId === session.id ? "bg-[#2a2b2f] text-white" : "text-white/70 hover:bg-white/5"}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#202125] text-xs font-semibold">{(session.company || session.title).slice(0, 2).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm font-medium">{session.title}</strong>
                      <small className="mt-1 block truncate text-xs text-white/40">{session.sessionType === "interview" ? "Interview" : "Regular call"} · {new Date(session.createdAt).toLocaleDateString()}</small>
                    </span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${session.status === "active" ? "bg-red-400" : session.status === "ended" ? "bg-white/25" : "bg-amber-300"}`} />
                  </button>
                ))
              ) : (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-white/50">{sessions.length ? "No sessions match this filter." : "Your sessions will appear here."}</p>
                  {!sessions.length && <button onClick={() => setCreateOpen(true)} className="mt-4 text-sm font-medium text-emerald-300 hover:text-emerald-200">Create your first session</button>}
                </div>
              )}
            </div>
            <div className="border-t border-white/10 px-4 py-3 text-xs text-white/40">
              <ShieldCheck size={14} className="mr-1 inline" /> Only you can access your sessions
            </div>
          </aside>

          {selected ? (
            <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#17181b]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-white">{selected.title}</h2>
                    <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-white/50">{selected.sessionType}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-white/45">{selected.description || selected.company || "No description added"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selected.status === "ready" && <button disabled={requestingMic} onClick={() => void startSession()} className="rounded-lg bg-[#257c3c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#2c9147] disabled:opacity-50">{requestingMic ? "Waiting for permission…" : "Start Session"}</button>}
                  {selected.status === "active" && <>
                    <span className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"><i className="h-2 w-2 animate-pulse rounded-full bg-red-400" /><Clock3 size={14} /> {formatDuration(selected.startedAt, now)}</span>
                    <button onClick={() => void endSession()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"><CircleStop size={15} /> End</button>
                  </>}
                  {selected.status === "ended" && <span className="rounded-lg bg-white/5 px-3 py-2 text-sm text-white/55">Ended</span>}
                </div>
              </div>

              <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
                <div className="min-w-0">
                  <div className="mb-4 rounded-xl border border-white/10 bg-[#101113] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-white">Live interview assistant</h3>
                        <p className="mt-1 max-w-[460px] text-xs leading-5 text-white/45">Ask a question to test Gemini, or turn on microphone transcription. Sonora only listens after you start it.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                      {window.sonoraDesktop && <select aria-label="Audio source" value={audioSource} disabled={listening || requestingMic} onChange={event => setAudioSource(event.target.value as "microphone" | "system")} className="max-w-full rounded-lg border border-white/10 bg-[#17181b] px-2 py-2 text-xs text-white disabled:opacity-50"><option value="microphone">Microphone</option><option value="system">System / call audio</option></select>}
                      <button
                        onClick={() => void toggleMicrophone()}
                        disabled={selected.status === "ended" || requestingMic}
                        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${listening ? "bg-red-500/15 text-red-200 ring-1 ring-red-400/30" : "bg-[#25272b] text-white hover:bg-[#303238]"}`}
                      >
                        <Mic size={15} /> {requestingMic ? "Requesting audio…" : listening ? "Stop capture" : window.sonoraDesktop ? "Enable audio" : "Enable mic"}
                      </button>
                      {requestingMic && <button onClick={stopCapture} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Cancel request</button>}
                      </div>
                    </div>
                    {listening && <div className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-emerald-100"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />{window.sonoraDesktop ? `${audioSource === "system" ? "System audio" : "Microphone"} capture active · Gemini chunk transcription` : "Microphone transcription is active in this browser."}</div>}
                    {!listening && selected.status === "active" && <p className="mt-3 text-[11px] text-white/35">Audio capture is off. Typed questions work without it.</p>}
                    <p className="mt-3 text-xs leading-5 text-white/40">{window.sonoraDesktop ? "Choose microphone or explicitly share system audio. The latter can include other apps. Only audio—not screen video—is sent for transcription. Use assistance only where permitted." : "This browser version captures your microphone, not Zoom, Meet, or Teams system audio. When using headphones, type the interviewer’s question below."}</p>
                    {interimTranscript && <p className="mt-3 rounded-lg border border-white/5 bg-white/[.03] p-3 text-sm italic text-white/55">{interimTranscript}</p>}
                    <form
                      className="mt-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const question = answerInput;
                        setAnswerInput("");
                        void askGemini(question);
                      }}
                    >
                      <label htmlFor="question-input" className="mb-2 block text-xs font-medium text-white/65">Test with a question</label>
                      <div className="flex gap-2">
                        <textarea
                          id="question-input"
                          value={answerInput}
                          onChange={(event) => setAnswerInput(event.target.value)}
                          placeholder="e.g. Tell me about a challenging project you worked on…"
                          className="min-h-[80px] flex-1 resize-y rounded-lg border border-white/10 bg-[#17181b] px-3 py-2.5 text-sm outline-none placeholder:text-white/35 focus:border-white/25"
                        />
                        <button disabled={busy || !answerInput.trim()} aria-label="Ask Gemini" className="self-end rounded-lg bg-[#257c3c] p-3 text-white disabled:cursor-not-allowed disabled:opacity-40"><Send size={17} /></button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/40"><Sparkles size={12} /> {selected.model} · {selected.answerPreference} answer · {selected.language}</div>
                      {selected.transcript.some((entry) => entry.source === "microphone") && <button type="button" onClick={() => setAnswerInput([...selected.transcript].reverse().find((entry) => entry.source === "microphone")?.text ?? "")} className="mt-3 text-xs font-medium text-emerald-300 hover:text-emerald-200">Use latest microphone transcript as the question</button>}
                    </form>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#101113] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-white">Suggested answer</h3>
                      {busy && <span className="text-xs text-white/45">Gemini is thinking…</span>}
                    </div>
                    {visibleAnswer ? (
                      <div className="whitespace-pre-wrap text-sm leading-6 text-white/85">{visibleAnswer}</div>
                    ) : (
                      <p className="text-sm leading-6 text-white/40">Ask a question above. Gemini will use this session’s description and context to draft a response; review it before answering.</p>
                    )}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">Transcript</h3>
                    <span className="text-[11px] text-white/40">{selected.saveTranscript ? "Saved to this session" : "Not saved"}</span>
                  </div>
                  <div className="mt-3 max-h-[440px] min-h-[300px] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#101113] p-4">
                    {selected.transcript.length ? selected.transcript.map((entry, index) => (
                      <div key={`${entry.createdAt}-${index}`} className={`rounded-lg p-3 ${entry.role === "assistant" ? "border border-emerald-300/10 bg-emerald-300/[.05]" : "bg-white/[.035]"}`}>
                        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/40">{entry.role === "assistant" ? <Sparkles size={11} /> : <FileText size={11} />}{entry.role === "assistant" ? "Gemini suggestion" : entry.source === "microphone" ? "You · mic transcript" : "Question"}</div>
                        <p className="whitespace-pre-wrap text-sm leading-5 text-white/75">{entry.text}</p>
                      </div>
                    )) : <div className="flex min-h-[250px] flex-col items-center justify-center px-4 text-center text-sm text-white/40"><FileText size={22} className="mb-3 text-white/25" />No transcript yet. Ask Gemini or enable the microphone.</div>}
                    {interimTranscript && <p className="rounded-lg bg-white/5 p-3 text-sm italic text-white/45">{interimTranscript}</p>}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-white/35">{window.sonoraDesktop ? "Desktop audio is sent to Gemini in six-second chunks. Audio is not retained by Sonora; recognized text is saved only when Save Transcript is on. System audio may include other apps. Stopping discards the incomplete final chunk." : "Speech recognition is provided by your browser. Sonora sends recognized text to Gemini only when it generates an answer."}</p>
                </div>
              </div>
            </section>
          ) : (
            <section className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#17181b] px-6 text-center">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-white/55"><FileText size={22} /></span>
              <h2 className="text-lg font-semibold text-white">Create an interview session</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/50">Add the role and your background, then test Gemini with a question before your interview starts.</p>
              <button onClick={() => setCreateOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#257c3c] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2c9147]"><Plus size={16} /> Create Session</button>
            </section>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
          <form onSubmit={handleCreate} className="my-auto max-h-[94vh] w-full max-w-[760px] overflow-y-auto rounded-2xl border border-white/10 bg-[#111214] p-5 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-semibold tracking-tight text-white">Create Session</h2>
              <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close" className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"><X size={20} /></button>
            </div>
            <label className="mb-2 block text-sm font-semibold">Session Type</label>
            <div className="mb-5 grid grid-cols-2 rounded-xl bg-[#242528] p-1">
              {(["interview", "call"] as const).map((type) => <button type="button" key={type} onClick={() => setForm((current) => ({ ...current, sessionType: type }))} className={`rounded-lg py-2.5 text-sm font-medium capitalize ${form.sessionType === type ? "bg-[#101113] text-white shadow" : "text-white/50 hover:text-white"}`}>{type === "call" ? "Regular Call" : "Interview"}</button>)}
            </div>
            {form.sessionType === "interview" ? <>
              <label className="mb-2 block text-sm font-semibold" htmlFor="company">Company</label>
              <input id="company" value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} placeholder="Company name" className="mb-4 w-full rounded-lg border border-white/10 bg-[#191a1d] px-4 py-3 text-sm outline-none placeholder:text-white/35 focus:border-white/25" />
              <label className="mb-2 block text-sm font-semibold" htmlFor="role-description">Interview Description</label>
              <textarea id="role-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Role, job description, and interview focus…" className="mb-4 min-h-24 w-full rounded-lg border border-white/10 bg-[#191a1d] px-4 py-3 text-sm outline-none placeholder:text-white/35 focus:border-white/25" />
            </> : <>
              <label className="mb-2 block text-sm font-semibold" htmlFor="call-title">Call Title <span className="font-normal text-white/40">(Optional)</span></label>
              <input id="call-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Call title" className="mb-4 w-full rounded-lg border border-white/10 bg-[#191a1d] px-4 py-3 text-sm outline-none placeholder:text-white/35 focus:border-white/25" />
              <label className="mb-2 block text-sm font-semibold" htmlFor="call-description">Description <span className="font-normal text-white/40">(Optional)</span></label>
              <textarea id="call-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What will you discuss?" className="mb-4 min-h-24 w-full rounded-lg border border-white/10 bg-[#191a1d] px-4 py-3 text-sm outline-none placeholder:text-white/35 focus:border-white/25" />
            </>}
            <div className="mb-2 mt-1 text-sm font-semibold">Context</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {form.sessionType === "interview" && <button type="button" onClick={() => { uploadTargetRef.current = "resume"; fileInputRef.current?.click(); }} className="inline-flex items-center gap-2 rounded-full border border-dashed border-white/20 px-4 py-2 text-sm hover:bg-white/5"><Upload size={14} /> {uploading === "resume" ? "Reading…" : form.resumeText ? "Resume added" : "Add Resume"}</button>}
              <button type="button" onClick={() => { uploadTargetRef.current = "documents"; fileInputRef.current?.click(); }} className="inline-flex items-center gap-2 rounded-full border border-dashed border-white/20 px-4 py-2 text-sm hover:bg-white/5"><Upload size={14} /> {uploading === "documents" ? "Reading…" : form.documentsText ? "Documents added" : "Add Documents"}</button>
              {form.resumeText && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200"><Check size={13} /> Resume text extracted</span>}
            </div>
            <p className="mb-4 text-xs leading-5 text-white/40">PDF, TXT, and Markdown are supported. Text is extracted in your browser and saved with this session; original files are not retained.</p>
            <details className="mb-5 rounded-lg border border-white/10 p-3">
              <summary className="cursor-pointer text-xs font-medium text-white/60">Review or paste context text</summary>
              <div className="mt-3 space-y-3">
                {form.sessionType === "interview" && <label className="block text-xs text-white/50">Resume text<textarea value={form.resumeText} onChange={(event) => setForm((current) => ({ ...current, resumeText: event.target.value.slice(0, 40_000) }))} className="mt-1.5 min-h-24 w-full rounded-lg border border-white/10 bg-[#191a1d] p-3 text-sm text-white outline-none" placeholder="Paste your resume text here…" /></label>}
                <label className="block text-xs text-white/50">Document text<textarea value={form.documentsText} onChange={(event) => setForm((current) => ({ ...current, documentsText: event.target.value.slice(0, 40_000) }))} className="mt-1.5 min-h-24 w-full rounded-lg border border-white/10 bg-[#191a1d] p-3 text-sm text-white outline-none" placeholder="Paste reference document text here…" /></label>
              </div>
            </details>
            <label className="mb-2 block text-sm font-semibold" htmlFor="instructions">Instructions <span className="font-normal text-white/40">(Optional)</span></label>
            <textarea id="instructions" value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} placeholder="Answer in a concise, confident, conversational tone…" className="mb-5 min-h-[70px] w-full rounded-lg border border-white/10 bg-[#191a1d] px-4 py-3 text-sm outline-none placeholder:text-white/35 focus:border-white/25" />
            <div className="mb-2 text-sm font-semibold">Output Settings</div>
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-white/45">Answer style<select value={form.answerPreference} onChange={(event) => setForm((current) => ({ ...current, answerPreference: event.target.value as NewSessionForm["answerPreference"] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#191a1d] px-3 py-2.5 text-sm text-white"><option value="concise">Concise</option><option value="detailed">Detailed</option><option value="technical">Technical</option></select></label>
              <label className="text-xs text-white/45">Gemini model<select value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value as NewSessionForm["model"] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#191a1d] px-3 py-2.5 text-sm text-white"><option value="gemini-2.5-flash">Gemini 2.5 Flash</option><option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option></select></label>
              <label className="text-xs text-white/45">Language<select value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#191a1d] px-3 py-2.5 text-sm text-white"><option>English</option><option>Spanish</option><option>French</option><option>German</option></select></label>
            </div>
            <div className="mb-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/75">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.autoAnswer} onChange={(event) => setForm((current) => ({ ...current, autoAnswer: event.target.checked }))} className="accent-emerald-500" /> Auto-generate suggestions for detected questions</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.saveTranscript} onChange={(event) => setForm((current) => ({ ...current, saveTranscript: event.target.checked }))} className="accent-emerald-500" /> Save Transcript</label>
            </div>
            {error && <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/5">Close</button>
              <button disabled={busy || uploading !== null} className="rounded-xl bg-[#f0f1f3] px-4 py-3 text-sm font-semibold text-[#151619] hover:bg-white disabled:opacity-50">{busy ? "Creating…" : "Create Session"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
