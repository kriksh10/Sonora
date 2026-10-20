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
import { createDesktopAudio, createAudioGroup, type AudioCapture } from "@/lib/desktop-audio";
import { createInterviewerQuestions } from "@/lib/interviewer-questions";
import { requestAnswer } from "@/lib/answer-stream";
import AudioReadiness from "@/components/audio-readiness";
import Modal from "@/components/modal";
import { useAccess } from "@/components/access-gate";
import { captureSpeaker, mayAutoAnswer, createRecentUtterance, type InterviewInputMode } from "@/lib/interview-input";
import { firstTextTiming } from "@/lib/live-timing";

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

export default function InterviewWorkspace() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const access = useAccess();
  const storageKey = `sonora:selected-session:${user?.id ?? "me"}`;
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => { try { return localStorage.getItem(storageKey); } catch { return null; } });
  const [filter, setFilter] = useState<"all" | "active" | "ended">("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [answerInput, setAnswerInput] = useState("");
  const [answer, setAnswer] = useState("");
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
  const [levels, setLevels] = useState({ microphone: 0, system: 0 });
  const [channelStatus, setChannelStatus] = useState({ microphone: "Audio off", system: "Audio off" });
  const [online, setOnline] = useState(navigator.onLine);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const settingsBusyRef = useRef(false);
  const lastRequestRef = useRef<{ question: string; action: "answer" | "shorten" | "explain" | "again"; previousAnswer?: string; persistQuestion: boolean } | null>(null);
  const answerAbortRef = useRef<AbortController | null>(null);
  const transcriptWritesRef = useRef<Promise<unknown>>(Promise.resolve());
  const [compact, setCompact] = useState(Boolean(window.sonoraDesktop));
  const streamRef = useRef<MediaStream | null>(null);
  const answerInFlightRef = useRef(false);
  const captureTokenRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const selectedSessionRef = useRef<CallSession | null>(selected);
  selectedSessionRef.current = selected;
  const settingsRevisionRef = useRef(0);
  const currentRound = selected?.roundNumber ?? 1;
  const currentEntries = (selected?.transcript ?? []).filter((entry) => roundOf(entry) === currentRound);
  const liveSession = selected ? { ...selected, transcript: currentEntries } : null;
  const shownEntries = (selected?.transcript ?? []).filter((entry) => roundView === "all" || roundOf(entry) === (roundView === "current" ? currentRound : roundView));
  const roundList = [...(selected?.rounds ?? []).filter((round) => round.number !== currentRound), { number: currentRound, startedAt: selected?.startedAt ?? null, endedAt: selected?.endedAt ?? null }]
    .sort((a, b) => a.number - b.number);
  const visibleAnswer = answer ||
      [...currentEntries].reverse().find((entry) => entry.role === "assistant")?.text ||
      "";

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
      action: "answer" | "shorten" | "explain" | "again" = "answer", previousAnswer?: string, receivedAt?: number) => {
      if (!selected) return;
      if (selected.status === "ended") { setError("This session has ended. Create a new session to ask questions."); return; }
      const cleanQuestion = question.trim();
      if (!cleanQuestion) return;
      if (answerInFlightRef.current) return;
      if (settingsBusyRef.current) { setNotice("Wait for answer settings to finish saving, then ask again."); return; }
      setLiveMode(true);
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
        const response = await requestAnswer(
          selected.id, { question: cleanQuestion, action, previousAnswer, roundNumber: selected.roundNumber },
          AbortSignal.any([controller.signal, AbortSignal.timeout(95_000)]),
          text => {
            if (stale()) return;
            if (!firstText && text.trim()) {
              firstText = true;
              setTimingSummary(firstTextTiming(requestedAt, receivedAt));
            }
            setAnswer(text); setAnswerState("streaming");
          },
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
    },
    [refreshSessions, saveTranscript, selected, settingsBusy],
  );
  const askRef = useRef(askGemini);
  askRef.current = askGemini;
  const questionsRef = useRef<ReturnType<typeof createInterviewerQuestions> | null>(null);
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
    captureTokenRef.current += 1;
    for (const capture of desktopCaptureRef.current) capture.stop();
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
  };

  const endSession = async () => {
    if (!selected) return;
    stopCapture();
    answerAbortRef.current?.abort();
    try {
      const updated = await api<CallSession>(`/sessions/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ended", roundNumber: selected.roundNumber }),
      });
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("Session ended. Its transcript is saved if Save Transcript was enabled.");
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
    if (!window.sonoraDesktop && audioSource !== "microphone") {
      setError("Call audio requires the packaged desktop app. Browser transcription supports your microphone only.");
      return;
    }
    if (window.sonoraDesktop || inputMode === "phone") {
      const captureToken = ++captureTokenRef.current;
      setRequestingMic(true);
      setError("");
      const sources: ("microphone" | "system")[] = inputMode === "phone" ? ["microphone"] : audioSource === "both" ? ["microphone", "system"] : [audioSource];
      if (sources.length === 2 && !supportsDualAudio) {
        setRequestingMic(false);
        setError("Rebuild and install the updated desktop app to capture both channels separately.");
        return;
      }
      const captures = sources.map(source => createDesktopAudio({
        source,
        ...(source === "system" && systemDevice ? { deviceName: systemDevice } : {}),
        sessionId: selected.id,
        roundNumber: selected.roundNumber,
        onLevel: (level, status) => {
          if (captureToken !== captureTokenRef.current) return;
          setLevels(current => ({ ...current, [source]: level }));
          setChannelStatus(current => ({ ...current, [source]: status }));
        },
        onPhase: status => { if (captureToken === captureTokenRef.current) setPipelineStatus(`${source === "system" ? "Call" : "Mic"} · ${status}`); },
        onTiming: ms => {
          if (captureToken === captureTokenRef.current) setTranscriptionTiming(`Last transcription ${(ms / 1000).toFixed(1)}s`);
        },
        onText: (text, metadata) => {
          if (captureToken !== captureTokenRef.current) return;
          const activeSession = selectedSessionRef.current;
          if (!activeSession || activeSession.id !== selected.id || (activeSession.roundNumber ?? 1) !== (selected.roundNumber ?? 1)) return;
          const currentMode = inputRef.current.mode;
          const routingRevision = inputRevisionRef.current;
          const speaker = captureSpeaker(currentMode, source, remoteConfirmed);
          if (currentMode === "phone") setRecentPhoneText(recentPhoneRef.current.append(text));
          setPipelineStatus(currentMode === "phone" ? "Mixed phone speech transcribed" : speaker === "interviewer" ? "Collecting interviewer question" : "Listening-only for this source");
          void saveTranscript(activeSession, "user", text, metadata.source, speaker, metadata.capturedAt).then(() => {
            if (captureToken !== captureTokenRef.current || routingRevision !== inputRevisionRef.current) return;
            const optedIn = inputRef.current.phoneAuto;
            if (!mayAutoAnswer(currentMode, source, remoteConfirmed, optedIn, !!selectedSessionRef.current?.autoAnswer)) return;
            if (currentMode === "phone") questionsRef.current?.pushMixed(text, optedIn, metadata.endOfTurn);
            else questionsRef.current?.push(text, speaker, metadata.endOfTurn);
          }).catch(cause => {
            if (captureToken !== captureTokenRef.current) return;
            stopCapture();
            setError(cause instanceof Error ? cause.message : "Could not save transcript. Capture stopped.");
          });
        },
        onNotice: text => { if (captureToken === captureTokenRef.current) setNotice(text); },
        onError: cause => {
          if (captureToken !== captureTokenRef.current) return;
          stopCapture();
          setError(cause.message);
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
          : `${audioSource === "both" ? "Separate microphone and call channels are" : audioSource === "system" ? "Call audio is" : "Microphone is"} on. ${audioSource === "microphone" ? "Your microphone never triggers auto-answer in computer-call mode." : remoteConfirmed ? "Confirmed remote questions can trigger Auto Answer." : "Speaker mapping unconfirmed: auto-answer is paused."}`);
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
            const activeSession = selectedSessionRef.current;
            if (activeSession) {
                void saveTranscript(activeSession, "user", text, "microphone", remoteConfirmed ? "candidate" : "unknown").catch(
                  (cause) =>
                    setError(cause instanceof Error ? cause.message : "Could not save transcript."),
                );
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
          body: JSON.stringify({ status: "active", roundNumber: selected.roundNumber }),
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
    <main className={`${liveMode && selected ? "" : "min-h-screen"} text-[#e7e8eb]`}
      style={{ background: window.sonoraDesktop ? "rgba(16,17,19,var(--sonora-background-opacity,0.85))" : "#101113" }}>
      {liveMode && selected && liveSession ? (
        <LiveSessionView
          session={liveSession} answer={answer} busy={busy} listening={listening}
          requestingAudio={requestingMic} interimTranscript={interimTranscript}
          duration={formatDuration(selected.startedAt, now)} notice={notice} error={error}
          audioSource={audioSource} remoteConfirmed={remoteConfirmed} supportsDualAudio={supportsDualAudio}
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
          latestQuestion={latestQuestion} answerState={answerState}
          pipelineStatus={!online ? "Offline · recording will not restart automatically. Reconnect, then retry." :
            settingsBusy ? "Saving settings…" : pipelineStatus}
          levels={levels} channelStatus={channelStatus}
          onAutoAnswerChange={value => void updateLiveSettings("autoAnswer", value)}
          onLengthChange={value => void updateLiveSettings("length", value)}
          onAnswerAction={modifyAnswer} onRetry={retryAnswer}
          onCancelAnswer={() => answerAbortRef.current?.abort()}
          onReadiness={() => { stopCapture(); answerAbortRef.current?.abort(); setReadinessOpen(true); }}
        />
      ) : (<>
      <header className={`${window.sonoraDesktop ? "desktop-drag" : ""} flex h-[60px] items-center justify-between border-b border-white/10 bg-[#17181b] px-4 sm:px-6`}>
        <a href={import.meta.env.BASE_URL} className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#75c853] text-[#19321d]"><Sparkles size={18} /></span>
          Sonora <span className="text-xs font-medium text-white/50">AI</span>
        </a>
        <div className="flex items-center gap-3 text-sm text-white/65">
          <span className="hidden sm:inline">{user?.primaryEmailAddress?.emailAddress}</span>
          {(access.role === "owner" || access.role === "approver") && <button data-testid="button-access" onClick={access.openAdmin} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5">{access.role === "owner" ? "Access" : "Approvals"}</button>}
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
                    <p className="mt-3 text-xs leading-5 text-white/40">{window.sonoraDesktop ? "Choose microphone or computer audio and approve capture. Computer audio can include other apps. Packaged native capture records audio only, not screen video. Use assistance only where permitted." : "This browser version captures your microphone, not Zoom, Meet, or Teams system audio. When using headphones, type the interviewer’s question below."}</p>
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
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/40"><Sparkles size={12} /> {selected.model} · {summarizePreferences(sessionPreferences(selected))} · {selected.language} <button type="button" data-testid="button-edit-preferences" onClick={() => setEditOpen(true)} className="ml-2 rounded-md border border-white/10 px-2 py-1 text-white/70 hover:bg-white/5">Edit preferences</button></div>
                      {currentEntries.some((entry) => entry.source === "microphone") && <button type="button" onClick={() => setAnswerInput([...currentEntries].reverse().find((entry) => entry.source === "microphone")?.text ?? "")} className="mt-3 text-xs font-medium text-emerald-300 hover:text-emerald-200">Use latest microphone transcript as the question</button>}
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
                  {roundList.length > 1 && <div className="mt-3 rounded-xl border border-white/10 bg-[#101113] p-3 text-xs" data-testid="panel-rounds">
                    <div className="mb-2 flex flex-wrap gap-1">
                      {([["current", "Current"], ["all", "All rounds"], ...roundList.filter((round) => round.number !== currentRound).map((round) => [round.number, `Round ${round.number}`] as const)] as const).map(([value, label]) => (
                        <button key={String(value)} onClick={() => setRoundView(value as "current" | "all" | number)} className={`rounded-md px-2 py-1 ${roundView === value ? "bg-[#2b2d31] text-white" : "text-white/50 hover:text-white/80"}`}>{label}</button>
                      ))}
                    </div>
                    <ul className="space-y-1 text-white/45">
                      {roundList.map((round) => <li key={round.number}><span className="text-white/70">Round {round.number}{round.number === currentRound ? " (current)" : ""}</span> · {round.startedAt || round.endedAt ? `${fmtDate(round.startedAt)} to ${round.number === currentRound && selected.status !== "ended" ? "in progress" : fmtDate(round.endedAt)}` : "dates unknown"}</li>)}
                    </ul>
                  </div>}
                  <div className="mt-3 max-h-[440px] min-h-[300px] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#101113] p-4">
                    {shownEntries.length ? shownEntries.map((entry, index) => (
                      <div key={`${entry.createdAt}-${index}`} className={`rounded-lg p-3 ${entry.role === "assistant" ? "border border-emerald-300/10 bg-emerald-300/[.05]" : "bg-white/[.035]"}`}>
                        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/40">{entry.role === "assistant" ? <Sparkles size={11} /> : <FileText size={11} />}{entry.role === "assistant" ? "Gemini suggestion" : entry.source === "microphone" ? (window.sonoraDesktop ? "Audio transcript" : "You · mic transcript") : "Question"}</div>
                        <p className="whitespace-pre-wrap text-sm leading-5 text-white/75">{entry.text}</p>
                      </div>
                    )) : <div className="flex min-h-[250px] flex-col items-center justify-center px-4 text-center text-sm text-white/40"><FileText size={22} className="mb-3 text-white/25" />{roundView === "current" && roundList.length > 1 ? "Nothing in this round yet." : "No transcript yet. Ask Gemini or enable the microphone."}</div>}
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
