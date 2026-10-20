import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Mic, Send, Settings2, Square } from "lucide-react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import FollowLatestPane from "@/components/follow-latest-pane";
import CallOutputPicker from "@/components/call-output-picker";
import "./live-session-view.css";

type AudioSource = "microphone" | "system" | "both";
type LiveEntry = TranscriptEntry & {
  speaker?: "candidate" | "interviewer" | "unknown";
  source: TranscriptEntry["source"] | "system";
};

export type LiveSessionViewProps = {
  session: CallSession;
  answer: string;
  busy: boolean;
  listening: boolean;
  requestingAudio: boolean;
  interimTranscript: string;
  duration: string;
  notice: string;
  error: string;
  audioSource: AudioSource;
  remoteConfirmed: boolean;
  supportsDualAudio: boolean;
  systemDevice?: string;
  onSystemDeviceChange?: (value: string) => void;
  onAudioSourceChange: (value: AudioSource) => void;
  onRemoteConfirmedChange: (value: boolean) => void;
  onToggleAudio: () => void;
  onEnd: () => void;
  onBack: () => void;
  onPreferences: () => void;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
  onUseTranscript: (text: string) => void;
  nativeControls?: ReactNode;
  latestQuestion?: string;
  answerState?: "idle" | "generating" | "streaming" | "complete" | "interrupted";
  pipelineStatus?: string;
  levels?: { microphone: number; system: number };
  channelStatus?: { microphone: string; system: string };
  onAutoAnswerChange?: (value: boolean) => void;
  onLengthChange?: (value: "short" | "balanced" | "long") => void;
  onAnswerAction?: (value: "shorten" | "explain" | "again") => void;
  onRetry?: () => void;
  onCancelAnswer?: () => void;
  onReadiness?: () => void;
  maintenanceControls?: ReactNode;
};

function Meter({ name, value }: { name: string; value: number }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span className="lsv-meter" role="meter" aria-label={`${name} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      {name}<b><i style={{ transform: `scaleX(${v})` }} /></b>
    </span>
  );
}

function isTextTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
}

function TranscriptPane(p: { sessionId: string; spoken: LiveEntry[]; interim: string; live: boolean; remoteConfirmed: boolean; onUse: (t: string) => void }) {
  return (
    <section className="lsv-pane" aria-label="Transcript">
      <header>
        <span>Transcript</span>
        <em>{p.live ? "Chunks of about six seconds" : "Audio off"}</em>
      </header>
      <FollowLatestPane resetKey={p.sessionId} label="Live transcript" testId="transcript-pane">
        {p.spoken.length === 0 && !p.interim && (
          <div className="lsv-empty">
            <strong>{p.live ? "Listening. Nothing transcribed yet." : "No transcript yet."}</strong>
            {p.live ? "Text appears after each chunk is processed." : "Press Start audio, or type a question."}
          </div>
        )}
        {p.spoken.map((e, i) => {
          const l = labelFor(e, p.remoteConfirmed);
          return (
            <div className="lsv-entry" key={`${e.createdAt}-${i}`}>
              <div className="lsv-meta">
                <span className={`lsv-who ${l.cls}`}>{l.text}</span>
                <span>{time(e.capturedAt || e.createdAt)}</span>
                <button type="button" className="lsv-use" onClick={() => p.onUse(e.text)}>Use as question</button>
              </div>
              <div className="lsv-text">{e.text}</div>
            </div>
          );
        })}
        {p.interim && (
          <div className="lsv-entry">
            <div className="lsv-meta"><span className="lsv-who unk">Transcribing</span></div>
            <div className="lsv-text lsv-interim">{p.interim}</div>
          </div>
        )}
      </FollowLatestPane>
    </section>
  );
}

function labelFor(entry: LiveEntry, _remoteConfirmed: boolean) {
  const t = entry.source;
  if (t === "typed") return { text: "Typed", cls: "" };
  if (entry.speaker === "interviewer") return { text: "Interviewer (tagged)", cls: "remote" };
  if (entry.speaker === "candidate") return { text: "Candidate", cls: "" };
  if (t === "microphone") {
    return { text: "Unknown · microphone", cls: "unk" };
  }
  if (t === "system") return { text: "Remote audio", cls: "remote" };
  return { text: "Unknown speaker", cls: "unk" };
}

function time(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LiveSessionView(p: LiveSessionViewProps) {
  const lockAudio = p.listening || p.requestingAudio;
  const entries = p.session.transcript as LiveEntry[];
  const spoken = useMemo(() => entries.filter((e) => e.role !== "assistant"), [entries]);
  const assistant = useMemo(() => entries.filter((e) => e.role === "assistant"), [entries]);
  const shownAnswer = p.answer || (assistant.length ? assistant[assistant.length - 1].text : "");
  const ended = p.session.status === "ended";
  const source = !p.supportsDualAudio && p.audioSource === "both" ? "microphone" : p.audioSource;
  const live = p.listening;
  const [txOpen, setTxOpen] = useState(false);
  useEffect(() => setTxOpen(false), [p.session.id]);

  const state = p.answerState ?? (p.busy ? "generating" : shownAnswer ? "complete" : "idle");
  const working = p.busy || state === "generating" || state === "streaming";
  const canAsk = !ended && !working && !!p.question.trim();
  const length = p.session.answerPreferences?.length ?? "balanced";
  const autoOn = p.session.autoAnswer;
  const canAct = !ended && !working && !!shownAnswer && !!p.latestQuestion;

  const ref = useRef(p);
  ref.current = p;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      const c = ref.current;
      const busy = c.busy || c.answerState === "generating" || c.answerState === "streaming" || c.session.status === "ended";
      if (busy) return;
      if (isTextTarget(e.target)) {
        if ((e.target as HTMLElement).getAttribute("data-testid") !== "input-question") return;
        e.preventDefault();
        if (c.question.trim()) c.onAsk();
        return;
      }
      if (c.question.trim()) { e.preventDefault(); c.onAsk(); }
      else if (c.latestQuestion?.trim() && c.onAnswerAction) { e.preventDefault(); c.onAnswerAction("again"); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const stateLabel =
    state === "generating" ? "Generating answer" :
    state === "streaming" ? "Streaming. Text may still change" :
    state === "interrupted" ? "Interrupted. Partial answer, not complete" :
    state === "complete" ? "Complete answer" : "No answer yet";

  let hint = "";
  if (ended) hint = "Session ended. Actions are disabled.";
  else if (!live) hint = "Audio is stopped. Sonora cannot hear or answer automatically until you start audio.";
  else if (!p.remoteConfirmed) hint = "Mapping off: confirm mic = you, call = interviewer. Stop audio to change it.";
  else if (source === "microphone") hint = "Microphone captures you, not the interviewer. Use Call audio for automatic answers, or ask manually.";
  else if (!autoOn) hint = "Auto Answer is off. Ask manually or turn it on.";

  return (
    <section data-testid="live-session-view" aria-label={`Live session: ${p.session.title}`} className={`lsv-root ${live ? "lsv-live" : ""}`}>
      <div className="lsv-bar desktop-drag" role="toolbar" aria-label="Live session controls">
        <span className="lsv-grip" aria-hidden="true"><i /><i /></span>
        <div className="lsv-title">
          <strong>{p.session.title}</strong>
          <span>{p.session.company || (p.session.sessionType === "interview" ? "Interview" : "Call")} · {p.session.saveTranscript ? "Transcript saved" : "Transcript not saved"}</span>
        </div>
        <div className="lsv-controls">
          <span className="lsv-timer" aria-label={`Elapsed ${p.duration}`}><i className="lsv-dot" />{p.duration}</span>
          <select aria-label="Audio source" className="lsv-select" data-testid="select-audio-source" value={source} disabled={lockAudio || ended} title={lockAudio ? "Stop audio before changing" : undefined}
            onChange={(e) => p.onAudioSourceChange(e.target.value as AudioSource)}>
            <option value="microphone">Microphone</option>
            <option value="system" disabled={!window.sonoraDesktop}>Call audio{!window.sonoraDesktop ? " (desktop only)" : ""}</option>
            {p.supportsDualAudio && <option value="both">Both</option>}
          </select>
          <label className="lsv-check" title={lockAudio ? "Stop audio before changing" : undefined}>
            <input type="checkbox" data-testid="checkbox-remote-confirmed" checked={p.remoteConfirmed} disabled={lockAudio || ended}
              onChange={(e) => p.onRemoteConfirmedChange(e.target.checked)} />
            Mic = me · call = interviewer
          </label>
          <button type="button" data-testid="button-toggle-audio" className={`lsv-btn ${live ? "lsv-stop" : "lsv-primary"}`} disabled={ended} onClick={p.onToggleAudio}>
            {live ? <Square size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
            {p.requestingAudio ? "Cancel request" : live ? "Stop audio" : autoOn && p.remoteConfirmed && source !== "microphone" ? "Start audio + answers" : "Start listening only"}
          </button>
          <button type="button" className="lsv-btn" data-testid="button-preferences" onClick={p.onPreferences}>
            <Settings2 size={13} aria-hidden="true" /> Answer settings
          </button>
          {p.onReadiness && <button type="button" className="lsv-btn" data-testid="button-readiness" onClick={p.onReadiness}>Readiness</button>}
          <button type="button" className="lsv-btn" data-testid="button-end-session" disabled={ended} onClick={p.onEnd}>End</button>
          <button type="button" className="lsv-btn" data-testid="button-back" onClick={p.onBack}>
            <ArrowLeft size={13} aria-hidden="true" /> Sessions
          </button>
          {p.nativeControls}
          {p.maintenanceControls}
        </div>
      </div>

      {!ended && (!p.remoteConfirmed || source === "microphone" || !autoOn) && (
        <div className="lsv-banner" role="status" data-testid="auto-answer-setup">
          <strong>Automatic answers are paused.</strong>{" "}
          {source === "microphone"
            ? "Microphone is candidate audio—not the interviewer. "
            : !p.remoteConfirmed ? "Confirm that call audio contains the interviewer, not your monitored microphone. " : "Auto Answer is switched off. "}
          {!lockAudio && source === "microphone" && window.sonoraDesktop && (
            <button type="button" data-testid="button-use-call-audio" className="lsv-btn" onClick={() => p.onAudioSourceChange("system")}>Use call audio</button>
          )}
          {!lockAudio && source !== "microphone" && !p.remoteConfirmed && (
            <label className="lsv-check">
              <input type="checkbox" data-testid="checkbox-confirm-interviewer" checked={false} onChange={e => p.onRemoteConfirmedChange(e.target.checked)} />
              I confirm call audio is the interviewer
            </label>
          )}
          {!autoOn && p.onAutoAnswerChange && (
            <button type="button" data-testid="button-enable-auto-answer" className="lsv-btn" onClick={() => p.onAutoAnswerChange?.(true)}>Enable Auto Answer</button>
          )}
          {lockAudio && <span> Stop audio before changing its source or speaker mapping.</span>}
          {!window.sonoraDesktop && <span> Call audio requires the desktop app. You can still type a question or select “Use as question” below.</span>}
        </div>
      )}

      {!ended && source !== "microphone" && p.onSystemDeviceChange && (
        <CallOutputPicker value={p.systemDevice ?? ""} onChange={p.onSystemDeviceChange} disabled={lockAudio} />
      )}

      {(p.error || p.notice) && (
        <div className={`lsv-banner ${p.error ? "err" : ""}`} role={p.error ? "alert" : "status"} data-testid="live-message">
          {p.error || p.notice}
        </div>
      )}

      <div className="lsv-status" data-testid="live-status">
        <span className={`lsv-chip ${live ? "ok" : ""}`}>{live ? "Capture started · see source activity" : "Audio off"}</span>
        <span className={`lsv-chip ${autoOn && p.remoteConfirmed && source !== "microphone" ? "ok" : "warn"}`}>
          Auto Answer {autoOn ? (!p.remoteConfirmed ? "paused, mapping off" : source === "microphone" ? "paused, no call source" : "on · remote only") : "off"}
          {p.onAutoAnswerChange && !ended && (
            <button type="button" data-testid="button-auto-answer" aria-pressed={autoOn} onClick={() => p.onAutoAnswerChange?.(!autoOn)}>
              {autoOn ? "Turn off" : "Turn on"}
            </button>
          )}
        </span>
        {p.pipelineStatus && <span className="lsv-chip" role="status" data-testid="text-pipeline-status">{p.pipelineStatus}</span>}
        {p.channelStatus && <span className="lsv-chip">Mic: {p.channelStatus.microphone} · Call: {p.channelStatus.system}</span>}
        {p.levels && live && (<><Meter name="Mic" value={p.levels.microphone} /><Meter name="Call" value={p.levels.system} /></>)}
        {hint && <span className="lsv-hint">{hint}</span>}
      </div>

      <div className={`lsv-body ${txOpen ? "has-tx" : ""}`}>
        <section className="lsv-pane" aria-label="Answer help">
          <header>
            <span>Answer</span>
            <em className={state === "interrupted" || state === "streaming" ? "lsv-label partial" : "lsv-label"} data-testid="text-answer-state">{stateLabel}</em>
          </header>
          <FollowLatestPane resetKey={p.session.id} label="Answer help" testId="answer-pane" jumpTestId="jump-to-latest-answer">
            {p.latestQuestion && <div className="lsv-q"><b>Question:</b> {p.latestQuestion}</div>}
            {working && <div className="lsv-meta" role="status">{state === "streaming" ? "Streaming now." : "Waiting for the answer."} The previous one stays below until replaced.</div>}
            {shownAnswer ? (
              <div className="lsv-answer" data-testid="text-current-answer">{shownAnswer}</div>
            ) : (!working && (
              <div className="lsv-empty"><strong>No answer yet.</strong>Ask below or use a transcript line as the question.</div>
            ))}
          </FollowLatestPane>
          <div className="lsv-actions">
            <div className="lsv-seg" role="radiogroup" aria-label="Answer length">
              {([["short", "Short"], ["balanced", "Balanced"], ["long", "Detailed"]] as const).map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={length === v} data-testid={`button-length-${v}`}
                  disabled={ended || working || !p.onLengthChange} onClick={() => p.onLengthChange?.(v)}>{t}</button>
              ))}
            </div>
            <button type="button" className="lsv-btn" data-testid="button-shorten" disabled={!canAct || !p.onAnswerAction} onClick={() => p.onAnswerAction?.("shorten")}>Shorten</button>
            <button type="button" className="lsv-btn" data-testid="button-explain" disabled={!canAct || !p.onAnswerAction} onClick={() => p.onAnswerAction?.("explain")}>Explain more</button>
            <button type="button" className="lsv-btn" data-testid="button-again" disabled={ended || working || !p.onAnswerAction || !p.latestQuestion} onClick={() => p.onAnswerAction?.("again")}>Answer again</button>
            {working && p.onCancelAnswer && <button type="button" className="lsv-btn lsv-stop" data-testid="button-cancel-answer" onClick={p.onCancelAnswer}>Cancel</button>}
            {state === "interrupted" && p.onRetry && !ended && <button type="button" className="lsv-btn lsv-primary" data-testid="button-retry" onClick={p.onRetry}>Retry</button>}
          </div>
          <form className="lsv-ask" onSubmit={(e) => { e.preventDefault(); if (canAsk) p.onAsk(); }}>
            <textarea aria-label="Question" data-testid="input-question" placeholder="Type a question. Enter to ask, Shift+Enter for new line" value={p.question} disabled={ended}
              onChange={(e) => p.onQuestionChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canAsk) p.onAsk(); }
              }} />
            <button type="submit" className="lsv-btn lsv-primary" data-testid="button-ask" disabled={!canAsk} title="Ctrl/Cmd+Enter">
              <Send size={13} aria-hidden="true" /> {working ? "Working" : "Ask"}
            </button>
            <button type="button" className="lsv-btn" data-testid="button-toggle-transcript" aria-expanded={txOpen} onClick={() => setTxOpen((v) => !v)}>
              {txOpen ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />} Transcript
            </button>
          </form>
        </section>

        {txOpen && <TranscriptPane sessionId={p.session.id} spoken={spoken} interim={p.interimTranscript} live={live} remoteConfirmed={p.remoteConfirmed} onUse={p.onUseTranscript} />}
      </div>
    </section>
  );
}
