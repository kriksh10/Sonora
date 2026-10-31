import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleStop,
  Clock3,
  FileText,
  LogOut,
  Mic,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import SessionWizard from "@/components/session-wizard";
import SessionPreferencesDialog from "@/components/session-preferences-dialog";
import { sessionPreferences, summarizePreferences } from "@/lib/answer-preferences";
import LiveSessionView from "@/components/live-session-view";
import { createDesktopAudio, createAudioGroup, serverSttAvailable, type AudioCapture } from "@/lib/desktop-audio";
import type { CaptureDiagnostic } from "@/lib/continuous-audio";
import { browserLanguage } from "@/lib/call-languages";
import { createInterviewerQuestions } from "@/lib/interviewer-questions";
import { createPhraseBuffer } from "@/lib/phrase-buffer";
import { clearVoicePrint, loadVoicePrint, recordVoicePrint, rememberSamples, saveVoicePrint, voiceMatches } from "@/lib/voice-profile";
import { requestAnswer } from "@/lib/answer-stream";
import AudioReadiness from "@/components/audio-readiness";
import Modal from "@/components/modal";
import { useAccess } from "@/components/access-gate";
import { captureSpeaker, mayAutoAnswer, createRecentUtterance, friendlyCaptureError, type InterviewInputMode } from "@/lib/interview-input";
import { firstTextTiming } from "@/lib/live-timing";
import SessionStudio, { CreditsCounter, creditLabel } from "@/components/session-studio";
import { apiRequest } from "@/lib/answer-preferences";
import { loadCreditBalance, type CreditBalance } from "@/lib/session-tools";
import { interpretDesktopCommand } from "@/lib/desktop-commands";

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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(20_000),
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

const roundOf = (entry: TranscriptEntry) => entry.roundNumber ?? 1;
const fmtDate = (value: string | null | undefined) => {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function formatDuration(startedAt: string | null, now: number) {
  if (!startedAt) return "00:00";
  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}

function callLength(session: CallSession, now: number) {
  if (!session.startedAt) return "Not started";
  const end = session.status === "ended" && session.endedAt ? new Date(session.endedAt).getTime() : now;
  const elapsed = Math.max(0, Math.floor((end - new Date(session.startedAt).getTime()) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusLabel(status: CallSession["status"]) {
  if (status === "active") return "Active";
  if (status === "ended") return "Ended";
  return "Ready";
}

function statusTone(status: CallSession["status"]) {
  if (status === "active") return "bg-red-500/15 text-red-100";
  if (status === "ended") return "bg-white/8 text-white/50";
  return "bg-amber-300/15 text-amber-100";
}

function sessionKind(session: CallSession) {
  if (session.sessionType === "mock") return "Mock";
  return session.sessionType === "interview" ? "Interview" : "Regular";
}

function sessionSubLabel(session: CallSession, now: number) {
  const kind = sessionKind(session);
  if (session.status === "ended") {
    return session.startedAt ? `${kind} · Ended · ${callLength(session, now)}` : `${kind} · Ended`;
  }
  return `${kind} · ${callLength(session, now)}`;
}

function sessionChoice(session: CallSession) {
  const company = session.company?.trim();
  return company ? `${company} · ${session.title}` : session.title;
}

export default function InterviewWorkspace() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const access = useAccess();
  const storageKey = `sonora:selected-session:${user?.id ?? "me"}`;
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => { try { return localStorage.getItem(storageKey); } catch { return null; } });
  const [filter, setFilter] = useState<"all" | "interview" | "call" | "mock">("all");
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [answerInput, setAnswerInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerCleared, setAnswerCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [roundView, setRoundView] = useState<"current" | "all" | number>("current");
  const restartRef = useRef<{ sessionId: string; round: number; requestId: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const desktopCaptureRef = useRef<AudioCapture[]>([]);
  const [audioSource, setAudioSource] = useState<"microphone" | "system" | "both">(window.sonoraDesktop ? "system" : "microphone");
  const [remoteConfirmed, setRemoteConfirmed] = useState(false);
  const [microphoneAuto, setMicrophoneAuto] = useState(false);
  const microphoneAutoRef = useRef(false);
  const preparedAudioContextRef = useRef<AudioContext | null>(null);
  microphoneAutoRef.current = microphoneAuto;
  const [inputMode, setInputMode] = useState<InterviewInputMode>("computer");
  const [phoneConsent, setPhoneConsent] = useState(false);
  const [phoneAuto, setPhoneAuto] = useState(false);
  const inputRef = useRef({ mode: inputMode, phoneAuto });
  const inputRevisionRef = useRef(0);
  inputRef.current = { mode: inputMode, phoneAuto };
  const recentPhoneRef = useRef(createRecentUtterance());
  const [recentPhoneText, setRecentPhoneText] = useState("");
  const [answerRecentShortcut, setAnswerRecentShortcut] = useState<"alt-enter" | "ctrl-shift-enter">("alt-enter");
  const [timingSummary, setTimingSummary] = useState("");
  const [transcriptionTiming, setTranscriptionTiming] = useState("");
  const [systemDevice, setSystemDevice] = useState("");
  const [supportsDualAudio, setSupportsDualAudio] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [latestQuestion, setLatestQuestion] = useState("");
  const [answerState, setAnswerState] = useState<"idle" | "generating" | "streaming" | "complete" | "interrupted">("idle");
  const [pipelineStatus, setPipelineStatus] = useState("");
  const [captureDiagnostics, setCaptureDiagnostics] = useState<CaptureDiagnostic[]>([]);
  const questionEndsRef = useRef<Record<string, number>>({});
  const measuredEndsRef = useRef<number[]>([]);
  const [levels, setLevels] = useState({ microphone: 0, system: 0 });
  const [channelStatus, setChannelStatus] = useState({ microphone: "Audio off", system: "Audio off" });
  const [online, setOnline] = useState(navigator.onLine);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const settingsBusyRef = useRef(false);
  const lastRequestRef = useRef<{ question: string; action: "answer" | "shorten" | "explain" | "again"; previousAnswer?: string; persistQuestion: boolean } | null>(null);
  const answerAbortRef = useRef<AbortController | null>(null);
  const transcriptWritesRef = useRef<Promise<unknown>>(Promise.resolve());
  const [compact, setCompact] = useState(Boolean(window.sonoraDesktop));
  const transcriptPane = useRef<HTMLDivElement>(null);
  const scrollTranscript = useRef(false);
  const [transcriptRequest, setTranscriptRequest] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const answerInFlightRef = useRef(false);
  const mySpeakerRef = useRef("");
  const voiceProfileRef = useRef(loadVoicePrint());
  const recentAudioRef = useRef<{ microphone: Float32Array; system: Float32Array }>({ microphone: new Float32Array(0), system: new Float32Array(0) });
  const [voiceReady, setVoiceReady] = useState(voiceProfileRef.current !== null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const screenshotRef = useRef<string | undefined>(undefined);
  const captureTokenRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const selectedSessionRef = useRef<CallSession | null>(selected);
  selectedSessionRef.current = selected;
  const settingsRevisionRef = useRef(0);
  const currentRound = selected?.roundNumber ?? 1;
  const [transcriptClearedAt, setTranscriptClearedAt] = useState<string | null>(null);
  useEffect(() => { setTranscriptClearedAt(null); }, [selectedId, currentRound]);
  const visibleTranscript = useCallback((entries: TranscriptEntry[]) => (
    transcriptClearedAt ? entries.filter(entry => (entry.createdAt ?? "") > transcriptClearedAt) : entries
  ), [transcriptClearedAt]);
  const currentEntries = visibleTranscript((selected?.transcript ?? []).filter((entry) => roundOf(entry) === currentRound));
  const liveSession = selected ? { ...selected, transcript: currentEntries } : null;
  const shownEntries = visibleTranscript((selected?.transcript ?? []).filter((entry) => roundView === "all" || roundOf(entry) === (roundView === "current" ? currentRound : roundView)));
  const roundList = [...(selected?.rounds ?? []).filter((round) => round.number !== currentRound), { number: currentRound, startedAt: selected?.startedAt ?? null, endedAt: selected?.endedAt ?? null }]
    .sort((a, b) => a.number - b.number);
  const visibleAnswer = answerCleared ? "" : answer ||
      [...currentEntries].reverse().find((entry) => entry.role === "assistant")?.text ||
      "";
  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(`sonora-capture:${selectedId}:${currentRound}`) ?? "[]");
      setCaptureDiagnostics(Array.isArray(cached) ? cached.slice(-120) : []);
    } catch { setCaptureDiagnostics([]); }
  }, [selectedId, currentRound]);

  useEffect(() => {
    let mounted = true;
    void window.sonoraDesktop?.getState().then(state => {
      if (mounted) setSupportsDualAudio((state.audioProtocol ?? 0) >= 2);
    }).catch(() => { /* Old shells continue to support one explicitly chosen source. */ });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    try { if (selectedId) localStorage.setItem(storageKey, selectedId); else localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
  }, [selectedId, storageKey]);

  const refreshSessions = useCallback(async () => {
    const revision = settingsRevisionRef.current;
    try {
      const data = await api<CallSession[]>("/sessions");
      if (revision !== settingsRevisionRef.current) return;
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
    let mounted = true;
    void loadCreditBalance(access.role, sessions.length).then((next) => {
      if (mounted) setCredits(next);
    }).catch(() => { if (mounted) setError("Credit balance could not be loaded. Reload to retry."); });
    return () => { mounted = false; };
  }, [access.role, sessions.length]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) window.dispatchEvent(new Event("sonora-stop-audio"));
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const saveTranscript = useCallback(
    async (
      session: CallSession,
      role: "user" | "assistant",
      text: string,
      source: TranscriptEntry["source"],
      speaker: "candidate" | "interviewer" | "unknown" = "unknown",
      capturedAt?: string,
    ) => {
      const write = async () => {
      const entry: TranscriptEntry = {
        role,
        text,
        source,
        speaker,
        ...(capturedAt ? { capturedAt } : {}),
        createdAt: new Date().toISOString(),
        roundNumber: session.roundNumber ?? 1,
      };
       const sameRound = (item: CallSession) => item.id === session.id && (item.roundNumber ?? 1) === (session.roundNumber ?? 1);
       if ((selectedSessionRef.current?.id === session.id ? selectedSessionRef.current : session).saveTranscript) {
        const updated = await api<CallSession>(
          `/sessions/${session.id}/transcript`,
          {
            method: "POST",
            body: JSON.stringify({ role, text, source, speaker, capturedAt, roundNumber: session.roundNumber }),
          },
        );
        setSessions((items) =>
          items.map((item) => (sameRound(item) ? {
            ...item, transcript: updated.saveTranscript ? updated.transcript : [...item.transcript, entry],
          } : item)),
        );
      } else {
        setSessions((items) =>
          items.map((item) =>
            sameRound(item)
              ? { ...item, transcript: [...item.transcript, entry] }
              : item,
          ),
        );
      }
      };
      const next = transcriptWritesRef.current.then(write);
      transcriptWritesRef.current = next.catch(() => {});
      return next;
    },
    [],
  );

  const askGemini = useCallback(
    async (question: string, source: "typed" | "microphone" | "system" = "typed", persistQuestion = true,
      action: "answer" | "shorten" | "explain" | "again" = "answer", previousAnswer?: string, receivedAt?: number, stayInWorkspace = false) => {
      if (!selected) return;
      if (selected.status === "ended") { setError("This session has ended. Create a new session to ask questions."); return; }
      const cleanQuestion = question.trim();
      if (!cleanQuestion || !/[\p{L}\p{N}]/u.test(cleanQuestion)) return;
      if (answerInFlightRef.current) return;
      if (settingsBusyRef.current) { setNotice("Wait for answer settings to finish saving, then ask again."); return; }
      if (!stayInWorkspace) setLiveMode(true);
      setAnswerCleared(false);
      answerInFlightRef.current = true;
      setBusy(true);
      setLatestQuestion(cleanQuestion);
      setAnswerState("generating");
      setTimingSummary("");
      setPipelineStatus("Preparing answer");
      setError("");
      const controller = new AbortController();
      answerAbortRef.current = controller;
      const askRound = selected.roundNumber ?? 1;
      const stale = () => controller.signal.aborted || selectedIdRef.current !== selected.id || (selectedSessionRef.current?.roundNumber ?? 1) !== askRound;
      const request = { question: cleanQuestion, action, previousAnswer, persistQuestion };
      lastRequestRef.current = request;
      const requestedAt = performance.now();
      let firstText = false;
      try {
        if (persistQuestion) {
          await saveTranscript(selected, "user", cleanQuestion, source);
          request.persistQuestion = false;
        }
        if (controller.signal.aborted) throw new Error("Answer cancelled.");
        const screenshot = screenshotRef.current;
        screenshotRef.current = undefined;
        const response = await requestAnswer(
          selected.id, { question: cleanQuestion, action, previousAnswer, roundNumber: selected.roundNumber },
          AbortSignal.any([controller.signal, AbortSignal.timeout(95_000)]),
          text => {
            if (stale()) return;
            if (!firstText && text.trim()) {
              firstText = true;
              const measuredEnd = receivedAt !== undefined && measuredEndsRef.current.includes(receivedAt);
              setTimingSummary(measuredEnd ? `First answer text ${((performance.now() - receivedAt!) / 1000).toFixed(1)}s after estimated question end` : firstTextTiming(requestedAt, receivedAt));
              if (receivedAt !== undefined) setCaptureDiagnostics(previous => {
                const event: CaptureDiagnostic = { at: new Date().toISOString(),
                  source: source === "typed" ? "microphone" : source, event: "latency",
                  detail: `${measuredEnd ? "Estimated question end" : "Transcript ready (acoustic end not measured)"} → first answer text: ${Math.round(performance.now() - receivedAt)}ms; request → first answer text: ${Math.round(performance.now() - requestedAt)}ms. Measures first nonempty streamed text, not an internal model token.` };
                const next = [...previous, event].slice(-120);
                try { sessionStorage.setItem(`sonora-capture:${selected.id}:${askRound}`, JSON.stringify(next)); } catch { /* visible in current log */ }
                return next;
              });
            }
            setAnswer(text); setAnswerState("streaming");
          },
          screenshot,
        );
        if (stale()) return;
        setAnswer(response.answer);
        setAnswerState("complete");
        setPipelineStatus("Answer complete");
        {
          const entry: TranscriptEntry = {
            role: "assistant",
            text: response.answer,
            source: "ai",
            createdAt: new Date().toISOString(),
            roundNumber: askRound,
          };
          setSessions((items) =>
            items.map((item) =>
              item.id === selected.id && (item.roundNumber ?? 1) === askRound
                ? { ...item, transcript: [...item.transcript, entry] }
                : item,
            ),
          );
        }
        return response.answer;
      } catch (cause) {
        if (selectedIdRef.current === selected.id && (selectedSessionRef.current?.roundNumber ?? 1) === askRound) {
          setAnswerState("interrupted");
          setError(controller.signal.aborted ? "Answer cancelled. Any partial text is not a completed answer." : cause instanceof Error ? cause.message : "Gemini could not answer. Retry when connected.");
        }
      } finally {
        if (answerAbortRef.current === controller) {
          answerInFlightRef.current = false;
          setBusy(false);
        }
      }
      return undefined;
    },
    [refreshSessions, saveTranscript, selected, settingsBusy],
  );
  const askRef = useRef(askGemini);
  askRef.current = askGemini;
  const phraseCommitRef = useRef<(phrase: { text: string; source: "microphone" | "system" | "typed"; speaker: "candidate" | "interviewer" | "unknown"; capturedAt: string }) => void>(() => {});
  phraseCommitRef.current = phrase => {
    const session = selectedSessionRef.current;
    if (!session || session.status === "ended") return;
    const token = captureTokenRef.current;
    const revision = inputRevisionRef.current;
    const endedAt = questionEndsRef.current[phrase.source];
    void saveTranscript(session, "user", phrase.text, phrase.source === "typed" ? "microphone" : phrase.source, phrase.speaker, phrase.capturedAt).then(() => {
      if (token !== captureTokenRef.current || revision !== inputRevisionRef.current) return;
      const mode = inputRef.current.mode;
      const optedIn = inputRef.current.phoneAuto;
      const heard = phrase.source === "system" ? "system" : "microphone";
      if (!mayAutoAnswer(mode, heard, remoteConfirmed, optedIn, !!selectedSessionRef.current?.autoAnswer, microphoneAutoRef.current)) return;
      if (mode === "phone" || heard === "microphone") questionsRef.current?.pushMixed(phrase.text, mode === "phone" ? optedIn : microphoneAutoRef.current, true, endedAt);
      else questionsRef.current?.push(phrase.text, phrase.speaker, true, endedAt);
    }).catch(cause => {
      if (token !== captureTokenRef.current) return;
      stopCapture();
      setError(cause instanceof Error ? cause.message : "Could not save transcript. Capture stopped.");
    });
  };
  const questionsRef = useRef<ReturnType<typeof createInterviewerQuestions> | null>(null);
  const phrasesRef = useRef<ReturnType<typeof createPhraseBuffer> | null>(null);
  if (!phrasesRef.current) phrasesRef.current = createPhraseBuffer({
    commit: phrase => phraseCommitRef.current(phrase),
    preview: text => setInterimTranscript(text),
  });
  if (!questionsRef.current) questionsRef.current = createInterviewerQuestions({
    answer: async (text, receivedAt, isCurrent) => {
      const session = selectedSessionRef.current;
      const permitted = () => inputRef.current.mode === "phone" ? inputRef.current.phoneAuto : selectedSessionRef.current?.autoAnswer;
      if (!session || !permitted() || session.status === "ended") return;
      const token = captureTokenRef.current;
      // A manual answer can also occupy the provider lane.
      while (answerInFlightRef.current || settingsBusyRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (captureTokenRef.current !== token || !isCurrent()) return;
      }
      if (!isCurrent() || selectedSessionRef.current?.id !== session.id || !permitted() || selectedSessionRef.current.status === "ended") return;
      if (inputRef.current.mode === "phone") {
        recentPhoneRef.current.clear();
        setRecentPhoneText("");
      }
      await askRef.current(text, inputRef.current.mode === "phone" ? "microphone" : "system", false, "answer", undefined, receivedAt);
    },
    notice: setNotice,
  });

  const stopCapture = useCallback(() => {
    phrasesRef.current?.flush();
    recentAudioRef.current = { microphone: new Float32Array(0), system: new Float32Array(0) };
    for (const capture of desktopCaptureRef.current) capture.stop();
    captureTokenRef.current += 1;
    const prepared = preparedAudioContextRef.current;
    preparedAudioContextRef.current = null;
    if (prepared && prepared.state !== "closed") void prepared.close().catch(() => {});
    desktopCaptureRef.current = [];
    questionsRef.current?.reset();
    recentPhoneRef.current.clear();
    setRecentPhoneText("");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setListening(false);
    setRequestingMic(false);
    setInterimTranscript("");
    setLevels({ microphone: 0, system: 0 });
    setChannelStatus({ microphone: "Audio off", system: "Audio off" });
    setPipelineStatus("Audio stopped");
  }, []);

  const changeInputMode = (mode: InterviewInputMode) => {
    if (mode === inputMode) return;
    stopCapture();
    answerAbortRef.current?.abort();
    setInputMode(mode);
    inputRef.current = { mode, phoneAuto: false };
    setPhoneConsent(false); setPhoneAuto(false);
    setRemoteConfirmed(false);
    setMicrophoneAuto(false);
    setAudioSource(mode === "phone" ? "microphone" : window.sonoraDesktop ? "system" : "microphone");
    setNotice("Input changed. Audio is off until you explicitly start it.");
    setTimingSummary(""); setTranscriptionTiming("");
  };
  const changePhoneAuto = (value: boolean) => {
    inputRevisionRef.current += 1;
    questionsRef.current?.reset();
    const allowed = value && phoneConsent;
    setPhoneAuto(allowed);
    inputRef.current = { mode: inputMode, phoneAuto: allowed };
  };
  const answerRecentPhone = () => {
    if (inputMode !== "phone" || !recentPhoneText.trim() || answerInFlightRef.current || settingsBusyRef.current) return;
    questionsRef.current?.reset();
    inputRevisionRef.current += 1;
    const text = recentPhoneRef.current.take();
    setRecentPhoneText("");
    if (text) void askRef.current(text, "microphone", false);
  };

  useEffect(() => {
    const off = window.sonoraDesktop?.onStopCapture(stopCapture);
    window.addEventListener("beforeunload", stopCapture);
    window.addEventListener("sonora-stop-audio", stopCapture);
    return () => { off?.(); window.removeEventListener("beforeunload", stopCapture); window.removeEventListener("sonora-stop-audio", stopCapture); stopCapture(); answerAbortRef.current?.abort(); };
  }, [stopCapture]);

  useEffect(() => {
    answerAbortRef.current?.abort();
    setAnswer("");
    setLatestQuestion("");
    setAnswerInput("");
    setAnswerState("idle");
    setError(""); setNotice("");
    lastRequestRef.current = null;
    setReadinessOpen(false);
    setRemoteConfirmed(false);
    setMicrophoneAuto(false);
    setAnswerCleared(false);
    setPhoneAuto(false); setPhoneConsent(false);
    inputRef.current = { mode: inputRef.current.mode, phoneAuto: false };
    setTimingSummary(""); setTranscriptionTiming("");
    setLiveMode(selectedSessionRef.current?.status === "active");
    setListening(false);
    setRequestingMic(false);
    setInterimTranscript("");
    return () => {
      stopCapture();
    };
  }, [selectedId, stopCapture]);

  const startSession = async () => {
    if (!selected) return;
    setLiveMode(true);
    if (selected.status !== "ready") return;
    try {
      const updated = await api<CallSession>(`/sessions/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active", roundNumber: selected.roundNumber }),
      });
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the session timer.");
    }
  };

  const endSession = async () => {
    if (!selected) return;
    phrasesRef.current?.flush();
    stopCapture();
    answerAbortRef.current?.abort();
    try {
      await transcriptWritesRef.current;
      const updated = await api<CallSession>(`/sessions/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ended", roundNumber: selected.roundNumber }),
      });
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      await apiRequest("/billing/settle", { method: "POST", body: JSON.stringify({ sessionId: updated.id }) });
      setCredits(await loadCreditBalance(access.role, sessions.length));
      setNotice("Session ended. Notes will appear below. Its transcript is saved if Save Transcript was enabled.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end the session.");
    }
  };

  const resetRoundState = () => {
    stopCapture();
    answerAbortRef.current?.abort();
    answerInFlightRef.current = false;
    questionsRef.current?.reset();
    setBusy(false); setAnswer(""); setLatestQuestion(""); setAnswerInput(""); setAnswerState("idle");
    setInterimTranscript(""); setRemoteConfirmed(false); setLiveMode(false); setReadinessOpen(false);
    setPhoneAuto(false); setPhoneConsent(false);
    inputRef.current = { mode: inputRef.current.mode, phoneAuto: false };
    setTimingSummary(""); setTranscriptionTiming("");
    lastRequestRef.current = null; setRoundView("current");
  };

  const startNextRound = async () => {
    if (!selected || selected.status !== "ended" || restarting) return;
    const id = selected.id;
    const round = selected.roundNumber ?? 1;
    if (!restartRef.current || restartRef.current.sessionId !== id || restartRef.current.round !== round) {
      restartRef.current = { sessionId: id, round, requestId: crypto.randomUUID() };
    }
    const requestId = restartRef.current.requestId;
    setRestarting(true); setError(""); setNotice("");
    try {
      const updated = await api<CallSession>(`/sessions/${id}/restart`, { method: "POST", body: JSON.stringify({ requestId, roundNumber: round }) });
      restartRef.current = null;
      settingsRevisionRef.current += 1;
      if (selectedIdRef.current === id) { selectedSessionRef.current = updated; resetRoundState(); }
      setSessions((items) => items.map((item) => (item.id === id ? updated : item)));
      if (selectedIdRef.current === id) setNotice(`Round ${updated.roundNumber ?? round + 1} is ready. Audio is off until you enable it.`);
    } catch (cause) {
      if (selectedIdRef.current === id) setError(cause instanceof Error ? cause.message : "Could not start the next round. Your interview is unchanged; try again.");
    } finally { setRestarting(false); }
  };

  const deleteInterview = async () => {
    if (!selected || selected.status !== "ended" || deleting) return;
    const id = selected.id;
    setDeleting(true); setError("");
    try {
      await api<unknown>(`/sessions/${id}`, { method: "DELETE" });
      settingsRevisionRef.current += 1;
      setDeleteOpen(false);
      resetRoundState();
      const remaining = sessions.filter((item) => item.id !== id);
      selectedSessionRef.current = null;
      setSessions(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setNotice("Interview deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the interview. Nothing was removed.");
      setDeleteOpen(false);
    } finally { setDeleting(false); }
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
    if (inputMode === "phone" && !phoneConsent) {
      setError("Confirm that the laptop microphone may capture both voices before starting phone-speaker mode.");
      return;
    }
    setLiveMode(true);
    // Unlock WebAudio during the click, before awaiting an API probe. Browsers
    // can suspend a context created after an asynchronous permission/network step.
    if (!window.sonoraDesktop && typeof AudioContext !== "undefined") {
      try {
        const prepared = new AudioContext();
        preparedAudioContextRef.current = prepared;
        void prepared.resume().catch(() => {});
      } catch { setError("This browser could not initialize audio. Try another supported browser."); return; }
    }
    const startToken = ++captureTokenRef.current;
    setRequestingMic(true);
    setError("");
    // The adapter negotiates Speechmatics first, then Gemini. Do not gate
    // a working live provider on a separate Gemini availability probe.
    const serverStt = true;
    if (startToken !== captureTokenRef.current) return;
    if (!serverStt && preparedAudioContextRef.current) {
      void preparedAudioContextRef.current.close().catch(() => {});
      preparedAudioContextRef.current = null;
    }
    if (!serverStt && audioSource !== "microphone" && !window.sonoraDesktop) {
      setRequestingMic(false);
      setError("Meeting-tab audio is transcribed on the server, and that service is unavailable right now. You can type a question, or switch to the microphone to try browser speech recognition.");
      return;
    }
    if (serverStt || window.sonoraDesktop || inputMode === "phone" || audioSource !== "microphone") {
      const captureToken = startToken;
      mySpeakerRef.current = "";
      recentAudioRef.current = { microphone: new Float32Array(0), system: new Float32Array(0) };
      setRequestingMic(true);
      setError("");
      const sources: ("microphone" | "system")[] = inputMode === "phone" ? ["microphone"] : audioSource === "both" ? ["microphone", "system"] : [audioSource];
      if (sources.length === 2 && !supportsDualAudio && window.sonoraDesktop) {
        setRequestingMic(false);
        setError("Rebuild and install the updated desktop app to capture both channels separately.");
        return;
      }
      const captures = sources.map(source => createDesktopAudio({
        source,
        ...(preparedAudioContextRef.current ? { context: preparedAudioContextRef.current } : {}),
        ...(source === "system" && systemDevice ? { deviceName: systemDevice } : {}),
        ...(source === "microphone" && audioSource === "both" && systemDevice ? { referenceDevice: systemDevice } : {}),
        sessionId: selected.id,
        roundNumber: selected.roundNumber,
        onPartial: text => { if (captureToken === captureTokenRef.current) setInterimTranscript(text); },
        onQuestionEnd: at => {
          if (captureToken !== captureTokenRef.current) return;
          if (!Number.isFinite(at)) { delete questionEndsRef.current[source]; return; }
          questionEndsRef.current[source] = at;
          measuredEndsRef.current = [...measuredEndsRef.current, at].slice(-40);
        },
        onLevel: (level, status) => {
          if (captureToken !== captureTokenRef.current) return;
          setLevels(current => ({ ...current, [source]: level }));
          setChannelStatus(current => ({ ...current, [source]: status }));
        },
        onPhase: status => { if (captureToken === captureTokenRef.current) setPipelineStatus(`${source === "system" ? "Call" : "Mic"} · ${status}`); },
        onTiming: ms => {
          if (captureToken === captureTokenRef.current) setTranscriptionTiming(`Last transcription ${(ms / 1000).toFixed(1)}s`);
        },
        onDiagnostic: event => {
          if (captureToken !== captureTokenRef.current) return;
          setCaptureDiagnostics(previous => {
            const next = [...previous, event].slice(-120);
            try { sessionStorage.setItem(`sonora-capture:${selected.id}:${selected.roundNumber ?? 1}`, JSON.stringify(next)); }
            catch { console.warn("Capture diagnostics are visible but could not be cached."); }
            return next;
          });
        },
        onPcm: samples => { if (captureToken === captureTokenRef.current) recentAudioRef.current[source] = rememberSamples(recentAudioRef.current[source], samples); },
        onText: (text, metadata) => {
          if (captureToken !== captureTokenRef.current) return;
          const activeSession = selectedSessionRef.current;
          if (!activeSession || activeSession.id !== selected.id || (activeSession.roundNumber ?? 1) !== (selected.roundNumber ?? 1)) return;
          const currentMode = inputRef.current.mode;
          const profile = voiceProfileRef.current;
          const hearsUser = source === "microphone" || audioSource !== "both";
          if (profile && metadata.speakerLabel && hearsUser && voiceMatches(profile, recentAudioRef.current[source])) {
            if (mySpeakerRef.current !== metadata.speakerLabel) {
              mySpeakerRef.current = metadata.speakerLabel;
              setNotice(`${metadata.speakerLabel} matches your saved voice. The other speaker is treated as the interviewer.`);
            }
          }
          const speaker = mySpeakerRef.current && metadata.speakerLabel
            ? (metadata.speakerLabel === mySpeakerRef.current ? "candidate" : "interviewer")
            : captureSpeaker(currentMode, source, remoteConfirmed);
          if (currentMode === "phone") setRecentPhoneText(recentPhoneRef.current.append(text));
          setPipelineStatus(metadata.speakerLabel
            ? `Speaker ${metadata.speakerLabel}`
            : currentMode === "phone" ? "Mixed phone speech transcribed" : speaker === "interviewer" ? "Collecting interviewer question" : "Listening-only for this source");
          phrasesRef.current?.push(text, { source: metadata.source, speaker, capturedAt: metadata.capturedAt });
          if (metadata.endOfTurn) phrasesRef.current?.flush();
        },
        onNotice: text => { if (captureToken === captureTokenRef.current) setNotice(text); },
        onTurnEnded: () => {
          if (captureToken !== captureTokenRef.current) return;
          phrasesRef.current?.flush();
        },
        onError: cause => {
          if (captureToken !== captureTokenRef.current) return;
          const serverDown = cause instanceof Error && cause.name === "ServerSttUnavailable";
          stopCapture();
          setError(serverDown
            ? "Live transcription and Gemini fallback are unavailable. Type a question, or retry listening when the services are available."
            : friendlyCaptureError(cause, source === "system" ? "system" : "microphone"));
        },
      }));
      const group = createAudioGroup(captures);
      desktopCaptureRef.current = [group];
      try {
        await group.start();
        if (captureToken !== captureTokenRef.current) { group.stop(); return; }
        if (selected.status === "ready") {
          const updated = await api<CallSession>(`/sessions/${selected.id}`, {
            method: "PATCH", body: JSON.stringify({ status: "active", roundNumber: selected.roundNumber }),
          });
          if (captureToken !== captureTokenRef.current) { group.stop(); return; }
          setSessions(items => items.map(item => item.id === updated.id ? updated : item));
        }
        if (captureToken !== captureTokenRef.current) { captures.forEach(item => item.stop()); return; }
        setListening(true);
        setNotice(inputMode === "phone"
          ? "Phone-speaker capture is on. Both voices are mixed; use Answer recent, or explicitly enable mixed-audio automatic answers."
          : `${audioSource === "both" ? "Microphone and meeting audio are" : audioSource === "system" ? "Meeting audio is" : "Microphone is"} on. Diagnostics show Speechmatics live or Gemini fallback. Meeting questions can be auto-answered; microphone questions require explicit opt-in.`);
      } catch (cause) {
        if (captureToken !== captureTokenRef.current) return;
        stopCapture();
        const serverDown = cause instanceof Error && cause.name === "ServerSttUnavailable";
        if (serverDown && !window.sonoraDesktop && sources.every((item) => item === "microphone")) {
          await startBrowserSpeech(captureTokenRef.current);
          return;
        }
        setError(serverDown
          ? "Server transcription is unavailable, so meeting-tab audio cannot be transcribed in this browser. Type a question, or try again when the speech service is up."
          : friendlyCaptureError(cause, sources.includes("system") ? "system" : "microphone"));
      } finally {
        if (captureToken === captureTokenRef.current) setRequestingMic(false);
      }
      return;
    }
    setNotice("Server transcription is unavailable. This browser’s speech recognition is a fallback and may fail outside Google Chrome.");
    await startBrowserSpeech(captureTokenRef.current + 1);
  };

  const startBrowserSpeech = async (captureToken: number) => {
    const session = selected;
    if (!session) return;
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
    captureTokenRef.current = captureToken;
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
      recognition.lang = browserLanguage(session.language);
      recognition.onresult = (event) => {
        if (captureToken !== captureTokenRef.current) return;
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = event.results[index][0]?.transcript?.trim() ?? "";
          if (!text) continue;
          if (event.results[index].isFinal) {
            phrasesRef.current?.push(text, {
              source: "microphone",
              speaker: remoteConfirmed ? "candidate" : "unknown",
              capturedAt: new Date().toISOString(),
            });
          } else {
            interim += `${text} `;
          }
        }
        if (interim.trim()) setInterimTranscript(interim.trim());
      };
      recognition.onerror = (event) => {
        stream.getTracks().forEach((track) => track.stop());
        if (captureToken !== captureTokenRef.current) return;
        setError(event.error === "not-allowed" || event.error === "audio-capture"
          ? friendlyCaptureError(Object.assign(new Error(event.error), { name: event.error === "not-allowed" ? "NotAllowedError" : "Error" }), "speech")
          : `Browser speech recognition stopped (${event.error}). You can still type a question.`);
        setListening(false);
        streamRef.current = null;
      };
      recognition.onend = () => {
        stream.getTracks().forEach((track) => track.stop());
        phrasesRef.current?.flush();
        if (captureToken !== captureTokenRef.current) return;
        setListening(false);
        streamRef.current = null;
      };
      recognitionRef.current = recognition;
      if (session.status === "ready") {
        const updated = await api<CallSession>(`/sessions/${session.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "active", roundNumber: session.roundNumber }),
        });
        if (captureToken !== captureTokenRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
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
      setError(friendlyCaptureError(cause, "speech"));
    } finally {
      if (captureToken === captureTokenRef.current) setRequestingMic(false);
    }
  };

  const updateLiveSettings = async (change: "autoAnswer" | "length", value: boolean | "short" | "balanced" | "long") => {
    if (!selected || selected.status === "ended" || settingsBusyRef.current) return;
    const id = selected.id;
    settingsBusyRef.current = true;
    setSettingsBusy(true); setError("");
    try {
      const updated = await api<CallSession>(`/sessions/${id}/preferences`, {
        method: "PATCH", signal: AbortSignal.timeout(15000), body: JSON.stringify(change === "autoAnswer"
          ? { autoAnswer: value }
          : { answerPreferences: { ...sessionPreferences(selected), length: value } }),
      });
      settingsRevisionRef.current += 1;
      if (!updated.autoAnswer) questionsRef.current?.reset();
      if (selectedIdRef.current === id) selectedSessionRef.current = updated;
      setSessions(items => items.map(item => item.id === id ? { ...updated, transcript: item.transcript } : item));
      setNotice("Settings saved for subsequent answers.");
    } catch (cause) { if (selectedIdRef.current === id) setError(cause instanceof Error ? cause.message : "Could not save settings."); }
    finally { settingsBusyRef.current = false; setSettingsBusy(false); }
  };
  const retryAnswer = () => {
    const request = lastRequestRef.current;
    if (request) void askGemini(request.question, "typed", request.persistQuestion, request.action, request.previousAnswer);
  };
  const modifyAnswer = (action: "shorten" | "explain" | "again") => {
    if (latestQuestion) void askGemini(latestQuestion, "typed", false, action, answer);
  };
  const commandRef = useRef({
    question: "", latestQuestion: "", recentPhoneText: "", answer: "", assistantAnswers: [] as string[], inputMode: "computer" as "phone" | "computer",
  });
  commandRef.current = {
    question: answerInput,
    latestQuestion,
    recentPhoneText,
    answer: visibleAnswer,
    assistantAnswers: currentEntries.filter(entry => entry.role === "assistant").map(entry => entry.text),
    inputMode,
  };
  const answerRecentRef = useRef(answerRecentPhone);
  answerRecentRef.current = answerRecentPhone;
  const modifyRef = useRef(modifyAnswer);
  modifyRef.current = modifyAnswer;
  useEffect(() => {
    const desktop = window.sonoraDesktop;
    if (!desktop?.onCommand) return;
    return desktop.onCommand(action => {
      const result = interpretDesktopCommand(action, commandRef.current);
      if (result.type === "ask") void askRef.current(result.question, result.source, result.source === "typed");
      else if (result.type === "ask-recent") answerRecentRef.current();
      else if (result.type === "again") modifyRef.current("again");
      else if (result.type === "show-answer") { setAnswerCleared(false); setAnswer(result.answer); setAnswerState("complete"); }
      else if (result.type === "scroll") {
        const pane = document.querySelector(".lsv-answer-pane .lsv-scroll");
        if (pane instanceof HTMLElement) pane.scrollBy({ top: result.top, behavior: "smooth" });
      }
      else if (result.type === "clear-answers") {
        setAnswer(""); setAnswerCleared(true); setAnswerInput(""); setLatestQuestion(""); setAnswerState("idle"); lastRequestRef.current = null;
        setNotice("Visible answers cleared. Your saved transcript is unchanged.");
      } else if (result.type === "clear-transcript") {
        setTranscriptClearedAt(new Date().toISOString());
        setInterimTranscript("");
        setNotice("Visible transcript cleared. The saved transcript is unchanged.");
      } else if (result.type === "screenshot") void (async () => {
        const image = await window.sonoraDesktop?.captureScreen?.();
        if (!image) return;
        screenshotRef.current = image;
        const question = commandRef.current.question.trim() || commandRef.current.latestQuestion.trim() || "Explain what is visible in this screenshot.";
        await askRef.current(question);
      })();
    });
  }, []);

  const visibleSessions = sessions.filter((session) => {
    const matchesFilter = filter === "all" || session.sessionType === filter;
    return (
      matchesFilter &&
      `${session.title} ${session.company ?? ""} ${session.description ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  const openTranscript = (id: string) => {
    setSelectedId(id);
    setAnswer("");
    setError("");
    setCompact(false);
    scrollTranscript.current = true;
    setTranscriptRequest(value => value + 1);
  };
  useEffect(() => {
    if (!scrollTranscript.current || liveMode) return;
    scrollTranscript.current = false;
    transcriptPane.current?.scrollIntoView({ block: "start" });
  }, [transcriptRequest, liveMode]);

  const recordVoice = async () => {
    if (listening || requestingMic) {
      setNotice("Stop capture before recording your voice.");
      return;
    }
    setVoiceRecording(true);
    setError("");
    try {
      const print = await recordVoicePrint();
      saveVoicePrint(print);
      voiceProfileRef.current = print;
      setVoiceReady(true);
      setNotice("Your voice is saved on this computer. It is used only to mark you in a mixed call.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record your voice.");
    } finally {
      setVoiceRecording(false);
    }
  };
  const clearVoice = () => {
    clearVoicePrint();
    voiceProfileRef.current = null;
    setVoiceReady(false);
    setNotice("Saved voice removed from this computer.");
  };

  return (
    <main className={`sonora-workspace ${liveMode && selected ? "" : "min-h-screen"} text-[#e7e8eb]`}
      style={{ background: window.sonoraDesktop ? "rgba(16,17,19,var(--sonora-background-opacity,0.4))" : "#101113" }}>
      {liveMode && selected && liveSession ? (
        <LiveSessionView
          session={liveSession} answer={answer} busy={busy} listening={listening}
          requestingAudio={requestingMic} interimTranscript={interimTranscript}
          duration={formatDuration(selected.startedAt, now)} notice={notice} error={error}
          audioSource={audioSource} remoteConfirmed={remoteConfirmed} supportsDualAudio={supportsDualAudio}
          microphoneAuto={microphoneAuto} onMicrophoneAutoChange={value => { questionsRef.current?.reset(); setMicrophoneAuto(value); }}
          systemDevice={systemDevice} onSystemDeviceChange={setSystemDevice}
          inputMode={inputMode} onInputModeChange={changeInputMode}
          phoneConsent={phoneConsent} onPhoneConsentChange={value => {
            if (!value) { stopCapture(); answerAbortRef.current?.abort(); changePhoneAuto(false); }
            setPhoneConsent(value);
          }}
          phoneAuto={phoneAuto} onPhoneAutoChange={changePhoneAuto}
          recentPhoneText={recentPhoneText} onAnswerRecent={answerRecentPhone}
          answerRecentShortcut={answerRecentShortcut} onAnswerRecentShortcutChange={setAnswerRecentShortcut}
          timingSummary={[timingSummary, transcriptionTiming].filter(Boolean).join(" · ")}
          onAudioSourceChange={setAudioSource} onRemoteConfirmedChange={setRemoteConfirmed}
          onToggleAudio={() => void toggleMicrophone()} onEnd={() => void endSession()}
          onBack={() => { stopCapture(); answerAbortRef.current?.abort(); setLiveMode(false); }}
          onPreferences={() => setEditOpen(true)}
          question={answerInput} onQuestionChange={setAnswerInput}
          onAsk={() => void askGemini(answerInput)} onUseTranscript={setAnswerInput}
          latestQuestion={latestQuestion} answerState={answerState === "idle" && visibleAnswer ? "complete" : answerState}
          pipelineStatus={!online ? "Offline · recording will not restart automatically. Reconnect, then retry." :
            settingsBusy ? "Saving settings…" : pipelineStatus}
          captureDiagnostics={captureDiagnostics}
          onClaimSpeaker={() => {
            const label = /^Speaker (\S+)/.exec(pipelineStatus)?.[1];
            if (!label) return;
            mySpeakerRef.current = label;
            setNotice(`${label} is you for this call. The other speaker is treated as the interviewer.`);
          }}
          voiceReady={voiceReady}
          voiceRecording={voiceRecording}
          onRecordVoice={() => void recordVoice()}
          onClearVoice={clearVoice}
          onScreenshot={window.sonoraDesktop?.captureScreen ? () => void (async () => {
            const image = await window.sonoraDesktop?.captureScreen?.();
            if (!image) return;
            screenshotRef.current = image;
            const question = answerInput.trim() || latestQuestion || "Explain what is visible in this screenshot.";
            await askGemini(question);
          })() : undefined}
          levels={levels} channelStatus={channelStatus}
          onAutoAnswerChange={value => void updateLiveSettings("autoAnswer", value)}
          onLengthChange={value => void updateLiveSettings("length", value)}
          onAnswerAction={modifyAnswer} onRetry={retryAnswer}
          onCancelAnswer={() => answerAbortRef.current?.abort()}
          onReadiness={() => { stopCapture(); answerAbortRef.current?.abort(); setReadinessOpen(true); }}
        />
      ) : (<>
      <header className={`${window.sonoraDesktop ? "desktop-drag sonora-glass" : ""} flex min-h-[60px] flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#17181b] px-4 py-2 sm:px-6`}>
        <a href={import.meta.env.BASE_URL} className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#75c853] text-[#19321d]"><Sparkles size={18} /></span>
          Sonora <span className="text-xs font-medium text-white/50">AI</span>
        </a>
        <div className="flex items-center gap-3 text-sm text-white/65">
          <span className="hidden sm:inline">{user?.primaryEmailAddress?.emailAddress}</span>
          {(access.role === "owner" || access.role === "approver") && <button data-testid="button-access" onClick={access.openAdmin} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5">{access.role === "owner" ? "Access" : "Approvals"}</button>}
          <a href={`${import.meta.env.BASE_URL}settings`} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5">Settings</a>
          <CreditsCounter label={creditLabel({
            bypass: access.role === "owner" || access.role === "approver" || !!credits?.bypass,
            balance: credits?.balance ?? 0,
            freeRemaining: credits?.freeRemaining ?? Math.max(0, 10 - sessions.length),
            unlimitedUntil: credits?.unlimitedUntil ?? null,
          })} />
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
        {window.sonoraDesktop && <div className="mb-4 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <select aria-label="Current desktop session" value={selectedId ?? ""} onChange={event => { if (!event.target.value) { setSelectedId(null); setAnswer(""); setError(""); return; } openTranscript(event.target.value); }} className="w-full rounded-lg border border-white/10 bg-[#17181b] px-3 py-2 text-sm"><option value="">Choose a session</option>{sessions.map(item => <option key={item.id} value={item.id}>{sessionChoice(item)}</option>)}</select>
            {compact && selected && <p className="mt-1 truncate text-xs text-white/70">{sessionSubLabel(selected, now)}</p>}
          </div>
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
          <aside className={`${compact ? "hidden" : "flex"} sonora-glass flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#17181b]`}>
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
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-[#101113] p-1 text-xs sm:grid-cols-4">
                {([["all", "All"], ["interview", "Interview"], ["call", "Regular"], ["mock", "Mock"]] as const).map(([item, label]) => (
                  <button key={item} className={`rounded-md px-2 py-1.5 ${filter === item ? "bg-[#2b2d31] text-white" : "text-white/45 hover:text-white/75"}`} onClick={() => setFilter(item)}>{label}</button>
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
                    type="button"
                    onClick={() => openTranscript(session.id)}
                    className={`mb-1 flex w-full items-start gap-3 rounded-xl p-3 text-left transition ${selectedId === session.id ? "bg-[#2a2b2f] text-white" : "text-white/70 hover:bg-white/5"}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#202125] text-xs font-semibold">{(session.company || session.title).slice(0, 2).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <strong className="truncate text-sm font-medium">{session.company?.trim() || session.title}</strong>
                        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusTone(session.status)}`}>{statusLabel(session.status)}</span>
                      </span>
                      {session.company?.trim() && <small className="mt-0.5 block truncate text-xs text-white/55">{session.title}</small>}
                      <small className="mt-1 block truncate text-xs text-white/40">{sessionSubLabel(session, now)}</small>
                    </span>
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
            <section className="sonora-glass min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#17181b]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-white">{selected.title}</h2>
                    <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-white/50">{selected.sessionType}</span>
                    <span data-testid="text-current-round" className="rounded-md bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-200">Round {currentRound}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-white/45">{selected.description || selected.company || "No description added"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selected.status === "ready" && <button disabled={requestingMic} onClick={() => void startSession()} className="rounded-lg bg-[#257c3c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#2c9147] disabled:opacity-50">{requestingMic ? "Waiting for permission…" : "Start Session"}</button>}
                  {selected.status === "active" && <>
                    <span className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"><i className="h-2 w-2 animate-pulse rounded-full bg-red-400" /><Clock3 size={14} /> {formatDuration(selected.startedAt, now)}</span>
                    <button onClick={() => void endSession()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"><CircleStop size={15} /> End</button>
                  </>}
                  {selected.status === "ended" && <>
                    <span className="rounded-lg bg-white/5 px-3 py-2 text-sm text-white/55">Ended</span>
                    <button data-testid="button-next-round" disabled={restarting || deleting} onClick={() => void startNextRound()} className="inline-flex items-center gap-2 rounded-lg bg-[#257c3c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#2c9147] disabled:opacity-50"><RotateCcw size={15} /> {restarting ? "Starting…" : "Start next round"}</button>
                    <button data-testid="button-delete-interview" disabled={restarting || deleting} onClick={() => setDeleteOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-red-400/25 px-3 py-2 text-sm text-red-200 hover:bg-red-500/10 disabled:opacity-50"><Trash2 size={15} /> Delete interview</button>
                  </>}
                </div>
              </div>

              <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
                <div className="min-w-0">
                  <div className="sonora-glass mb-4 rounded-xl border border-white/10 bg-[#101113] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-white">Live interview assistant</h3>
                        <p className="mt-1 max-w-[460px] text-xs leading-5 text-white/45">Ask a question to test Gemini, or turn on microphone transcription. Sonora only listens after you start it.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                      <select aria-label="Audio source" value={audioSource} disabled={listening || requestingMic} onChange={event => setAudioSource(event.target.value as "microphone" | "system")} className="max-w-full rounded-lg border border-white/10 bg-[#17181b] px-2 py-2 text-xs text-white disabled:opacity-50"><option value="microphone">Microphone</option><option value="system">{window.sonoraDesktop ? "System / call audio" : "Meeting tab"}</option></select>
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
                    {listening && <div className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-emerald-100"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />{audioSource === "system" ? (window.sonoraDesktop ? "System audio" : "Meeting tab") : "Microphone"} capture active · words appear as people talk</div>}
                    {!listening && selected.status === "active" && <p className="mt-3 text-[11px] text-white/35">Audio capture is off. Typed questions work without it.</p>}
                    <p className="mt-3 text-xs leading-5 text-white/40">{window.sonoraDesktop ? "Choose microphone or computer audio and approve capture. Computer audio can include other apps. Packaged native capture records audio only, not screen video. Use assistance only where permitted." : "Choose Microphone to hear yourself, or Meeting tab to hear the call. In Chrome, share the Meet, Zoom, or Teams tab and turn on Share tab audio. Sonora uses the audio from that share and does not save the picture."}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => void recordVoice()} disabled={voiceRecording || listening || requestingMic} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50">{voiceRecording ? "Listening to you…" : voiceReady ? "Record my voice again" : "Record my voice"}</button>
                      {voiceReady && <button type="button" onClick={clearVoice} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60 hover:bg-white/5">Clear saved voice</button>}
                      <span className="text-[11px] text-white/40">{voiceReady ? "Your voice is saved on this computer and marks you in a mixed call." : "Record a few seconds of your voice. It stays on this computer and marks you when both voices are in one recording."}</span>
                    </div>
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
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            if (busy || !answerInput.trim()) return;
                            const question = answerInput;
                            setAnswerInput("");
                            void askGemini(question);
                          }}
                          placeholder="Type a question. Enter to ask, Shift+Enter for a new line"
                          className="min-h-[80px] flex-1 resize-y rounded-lg border border-white/10 bg-[#17181b] px-3 py-2.5 text-sm outline-none placeholder:text-white/35 focus:border-white/25"
                        />
                        <button disabled={busy || !answerInput.trim()} aria-label="Ask Gemini" className="self-end rounded-lg bg-[#257c3c] p-3 text-white disabled:cursor-not-allowed disabled:opacity-40"><Send size={17} /></button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/40"><Sparkles size={12} /> {selected.model} · {summarizePreferences(sessionPreferences(selected))} · {selected.language} <button type="button" data-testid="button-edit-preferences" onClick={() => setEditOpen(true)} className="ml-2 rounded-md border border-white/10 px-2 py-1 text-white/70 hover:bg-white/5">Edit preferences</button></div>
                      {currentEntries.some((entry) => entry.source === "microphone") && <button type="button" onClick={() => setAnswerInput([...currentEntries].reverse().find((entry) => entry.source === "microphone")?.text ?? "")} className="mt-3 text-xs font-medium text-emerald-300 hover:text-emerald-200">Use latest microphone transcript as the question</button>}
                    </form>
                    <label className="flex gap-2 text-sm"><input type="checkbox" checked={microphoneAuto} onChange={e => setMicrophoneAuto(e.target.checked)} />Also auto-answer microphone questions (may include your own speech)</label>
                    <SessionStudio key={`${selected.id}:${selected.roundNumber}`}
                      session={selected}
                      now={now}
                      busy={busy}
                      onAsk={(question) => askGemini(question, "typed", true, "answer", undefined, undefined, true)}
                      onClear={() => { setAnswer(""); setAnswerCleared(true); setAnswerInput(""); setLatestQuestion(""); setAnswerState("idle"); lastRequestRef.current = null; setNotice("Visible chat and answer cleared. Your saved transcript is unchanged."); }}
                      onUseScreenshot={(image, question) => {
                        screenshotRef.current = image;
                        return askGemini(question, "typed", true, "answer", undefined, undefined, true);
                      }}
                    />
                  </div>
                  <div className="sonora-glass rounded-xl border border-white/10 bg-[#101113] p-4">
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

                <div className="min-w-0" ref={transcriptPane} id="session-transcript">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">Transcript</h3>
                    <span className="text-[11px] text-white/40">{selected.saveTranscript ? "Saved to this session" : "Not saved"}</span>
                  </div>
                  {roundList.length > 1 && <div className="sonora-glass mt-3 rounded-xl border border-white/10 bg-[#101113] p-3 text-xs" data-testid="panel-rounds">
                    <div className="mb-2 flex flex-wrap gap-1">
                      {([["current", "Current"], ["all", "All rounds"], ...roundList.filter((round) => round.number !== currentRound).map((round) => [round.number, `Round ${round.number}`] as const)] as const).map(([value, label]) => (
                        <button key={String(value)} onClick={() => setRoundView(value as "current" | "all" | number)} className={`rounded-md px-2 py-1 ${roundView === value ? "bg-[#2b2d31] text-white" : "text-white/50 hover:text-white/80"}`}>{label}</button>
                      ))}
                    </div>
                    <ul className="space-y-1 text-white/45">
                      {roundList.map((round) => <li key={round.number}><span className="text-white/70">Round {round.number}{round.number === currentRound ? " (current)" : ""}</span> · {round.startedAt || round.endedAt ? `${fmtDate(round.startedAt)} to ${round.number === currentRound && selected.status !== "ended" ? "in progress" : fmtDate(round.endedAt)}` : "dates unknown"}</li>)}
                    </ul>
                  </div>}
                  <div className="sonora-glass mt-3 max-h-[440px] min-h-[300px] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#101113] p-4">
                    {shownEntries.length ? shownEntries.map((entry, index) => (
                      <div key={`${entry.createdAt}-${index}`} className={`rounded-lg p-3 ${entry.role === "assistant" ? "border border-emerald-300/10 bg-emerald-300/[.05]" : "bg-white/[.035]"}`}>
                        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/40">{entry.role === "assistant" ? <Sparkles size={11} /> : <FileText size={11} />}{entry.role === "assistant" ? "Gemini suggestion" : entry.source === "microphone" ? (window.sonoraDesktop ? "Audio transcript" : "You · mic transcript") : "Question"}</div>
                        <p className="whitespace-pre-wrap text-sm leading-5 text-white/75">{entry.text}</p>
                      </div>
                    )) : <div className="flex min-h-[250px] flex-col items-center justify-center px-4 text-center text-sm text-white/40"><FileText size={22} className="mb-3 text-white/25" />{roundView === "current" && roundList.length > 1 ? "Nothing in this round yet." : "No transcript yet. Ask Gemini or enable the microphone."}</div>}
                    {interimTranscript && <p className="rounded-lg bg-white/5 p-3 text-sm italic text-white/45">{interimTranscript}</p>}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-white/35">{window.sonoraDesktop ? "Live words are sent while capture is on. If that stream is unavailable, finished phrases still go to Gemini, up to 4.5 seconds. Recognized text is saved only when Save Transcript is on. System audio may include other apps." : "Speech recognition is provided by your browser. Sonora sends recognized text to Gemini only when it generates an answer."}</p>
                </div>
              </div>
            </section>
          ) : (
            <section className="sonora-glass flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#17181b] px-6 text-center">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-white/55"><FileText size={22} /></span>
              <h2 className="text-lg font-semibold text-white">Create an interview session</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/50">Add the role and your background, then test Gemini with a question before your interview starts.</p>
              <button onClick={() => setCreateOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#257c3c] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2c9147]"><Plus size={16} /> Create Session</button>
            </section>
          )}
        </div>
      </div>
      </>)}

      {createOpen && (
        <SessionWizard
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            settingsRevisionRef.current += 1;
            setSessions((items) => [created, ...items]);
            setSelectedId(created.id);
            setAnswer("");
            setCreateOpen(false);
          }}
        />
      )}
      {deleteOpen && selected && (
        <Modal label="Delete interview" onClose={() => setDeleteOpen(false)} busy={deleting} width="max-w-[440px]">
          <h2 className="text-lg font-semibold text-white">Delete this interview?</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">&ldquo;{selected.title}&rdquo; and all of its rounds, saved transcripts and answers will be permanently removed. This cannot be undone.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button data-autofocus disabled={deleting} onClick={() => setDeleteOpen(false)} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/5">Cancel</button>
            <button data-testid="button-confirm-delete" disabled={deleting} onClick={() => void deleteInterview()} className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">{deleting ? "Deleting…" : "Delete permanently"}</button>
          </div>
        </Modal>
      )}
      {readinessOpen && selected && (
        <AudioReadiness key={selected.id} sessionId={selected.id} roundNumber={selected.roundNumber} systemDevice={systemDevice}
          onClose={() => setReadinessOpen(false)} answerBusy={busy} supportsDualAudio={supportsDualAudio} />
      )}
      {editOpen && selected && (
        <SessionPreferencesDialog
          key={selected.id}
          session={selected}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            settingsRevisionRef.current += 1;
            if (!updated.autoAnswer) questionsRef.current?.reset();
            if (selectedSessionRef.current?.id === updated.id) selectedSessionRef.current = updated;
            if (listening && selected.language !== updated.language && !window.sonoraDesktop) {
              stopCapture();
              setNotice("Preferences saved. Restart microphone capture to use the new call language.");
            } else {
              setNotice("Preferences saved. New settings apply to subsequent answers.");
            }
            setSessions((items) => items.map((item) => (item.id === updated.id ? { ...updated, transcript: item.transcript } : item)));
            setEditOpen(false);
          }}
        />
      )}
    </main>
  );
}
