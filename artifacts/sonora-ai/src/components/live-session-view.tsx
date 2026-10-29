import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Mic, MoreHorizontal, Send, Settings2, Square } from "lucide-react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import FollowLatestPane from "@/components/follow-latest-pane";
import SafeMarkdown from "@/components/safe-markdown";
import CaptureDiagnostics from "@/components/capture-diagnostics";
import type { CaptureDiagnostic } from "@/lib/continuous-audio";
import CallOutputPicker from "@/components/call-output-picker";
import "./live-session-view.css";

type AudioSource = "microphone" | "system" | "both";
type LiveEntry = TranscriptEntry & {
  speaker?: "candidate" | "interviewer" | "unknown";
  source: TranscriptEntry["source"] | "system";
};

export type LiveSessionViewProps = {
  captureDiagnostics?: CaptureDiagnostic[];
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
  microphoneAuto: boolean;
  onMicrophoneAutoChange: (value: boolean) => void;
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
  inputMode?: "computer" | "phone";
  onInputModeChange?: (value: "computer" | "phone") => void;
  phoneConsent?: boolean;
  onPhoneConsentChange?: (value: boolean) => void;
  phoneAuto?: boolean;
  onPhoneAutoChange?: (value: boolean) => void;
  recentPhoneText?: string;
  onAnswerRecent?: () => void;
  answerRecentShortcut?: "alt-enter" | "ctrl-shift-enter";
  onAnswerRecentShortcutChange?: (value: "alt-enter" | "ctrl-shift-enter") => void;
  timingSummary?: string;
  onClaimSpeaker?: () => void;
  onScreenshot?: () => void;
  voiceReady?: boolean;
  voiceRecording?: boolean;
  onRecordVoice?: () => void;
  onClearVoice?: () => void;
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

function TranscriptPane(p: { sessionId: string; spoken: LiveEntry[]; interim: string; live: boolean; phone: boolean; onUse: (t: string) => void }) {
  return (
    <section className="lsv-pane" aria-label="Transcript">
      <header>
        <span>Transcript</span>
        <em>{p.live ? "Words appear as people talk" : "Audio off"}</em>
      </header>
      <FollowLatestPane resetKey={p.sessionId} label="Live transcript" testId="transcript-pane">
        {p.spoken.length === 0 && !p.interim && (
          <div className="lsv-empty">
            <strong>{p.live ? "Listening. Nothing transcribed yet." : "No transcript yet."}</strong>
            {p.live ? "Words show up while someone is speaking." : "Press Start audio, or type a question."}
          </div>
        )}
        {p.spoken.map((e, i) => {
          const l = p.phone && e.source !== "typed" ? { text: "Mixed audio, speaker unknown", cls: "unk" } : labelFor(e, false);
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
  const phone = p.inputMode === "phone";
  const source = !p.supportsDualAudio && p.audioSource === "both" ? "microphone" : p.audioSource;
  const live = p.listening;
  const [txOpen, setTxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  useEffect(() => { setTxOpen(false); setMenuOpen(false); setRecentOpen(false); }, [p.session.id]);

  const state = p.answerState ?? (p.busy ? "generating" : shownAnswer ? "complete" : "idle");
  const working = p.busy || state === "generating" || state === "streaming";
  const canAsk = !ended && !working && !!p.question.trim();
  const length = p.session.answerPreferences?.length ?? "balanced";
  const autoOn = p.session.autoAnswer;
  const canAct = !ended && !working && !!shownAnswer && !!p.latestQuestion;
  const recent = (p.recentPhoneText ?? "").trim();
  const canRecent = phone && !!p.onAnswerRecent && !!recent && !working && !ended;
  const shortcut = p.answerRecentShortcut ?? "alt-enter";
  const shortcutLabel = shortcut === "alt-enter" ? "Alt+Enter" : "Ctrl/Cmd+Shift+Enter";
  const needConsent = phone && !live && !p.phoneConsent;

  const ref = useRef(p);
  ref.current = p;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Enter") return;
      const c = ref.current;
      const busy = c.busy || c.answerState === "generating" || c.answerState === "streaming" || c.session.status === "ended";
      if (busy) return;
      const sc = c.answerRecentShortcut ?? "alt-enter";
      const isRecent = sc === "alt-enter"
        ? e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
        : (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
      if (isRecent) {
        if (c.inputMode !== "phone" || !c.onAnswerRecent || !(c.recentPhoneText ?? "").trim()) return;
        if (isTextTarget(e.target) && (e.target as HTMLElement).getAttribute("data-testid") !== "input-question") return;
        e.preventDefault();
        c.onAnswerRecent();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
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
    state === "generating" ? "Generating" :
    state === "streaming" ? "Streaming, may still change" :
    state === "interrupted" ? "Interrupted, partial" :
    state === "complete" ? "Complete" : "No answer yet";

  const autoReady = autoOn && (source !== "microphone" || p.microphoneAuto);
  let hint = "";
  if (ended) hint = "Session ended. Actions are disabled.";
  else if (phone) hint = "";
  else if (!live) hint = "Audio is stopped. The microphone is you. A shared meeting tab is the interviewer.";
  else if (!autoOn) hint = "Auto Answer is off. The microphone is you and will not be answered. Turn it on and share the meeting tab to answer the interviewer.";
  else if (source === "microphone") hint = p.microphoneAuto ? "Microphone questions will be answered. This may include your own speech." : "Enable microphone questions in Session, or share meeting audio.";
  else hint = "Auto Answer is on. Meeting-tab audio is the interviewer. Your microphone is you and stays manual.";

  const showAutoBanner = !phone && !ended;
  const startLabel = p.requestingAudio ? "Cancel request" : live ? "Stop" : phone ? "Start phone listening" : autoReady ? "Start audio + answers" : "Start listening";

  return (
    <section data-testid="live-session-view" aria-label={`Live session: ${p.session.title}`} className={`lsv-root ${live ? "lsv-live" : ""}`}>
      <div className="lsv-bar desktop-drag" role="toolbar" aria-label="Live session controls">
        <span className="lsv-grip" aria-hidden="true"><i /><i /></span>
        <div className="lsv-title">
          <strong>{p.session.title}</strong>
          <span>{p.session.company || (p.session.sessionType === "mock" ? "Mock interview" : p.session.sessionType === "interview" ? "Interview" : "Call")} · {p.session.saveTranscript ? "Transcript saved" : "Transcript not saved"}</span>
        </div>
        <div className="lsv-controls">
          <span className="lsv-timer" aria-label={`Elapsed ${p.duration}`}><i className="lsv-dot" />{live ? "Recording " : ""}{p.duration}</span>
          <button type="button" data-testid="button-toggle-audio" className={`lsv-btn ${live ? "lsv-stop" : "lsv-primary"}`} disabled={ended || (needConsent && !p.requestingAudio)} onClick={p.onToggleAudio}>
            {live ? <Square size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
            {startLabel}
          </button>
          <button type="button" className="lsv-btn" data-testid="button-session-menu" aria-expanded={menuOpen} aria-controls="lsv-menu" onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={14} aria-hidden="true" /> Session
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="lsv-menu" id="lsv-menu" role="region" aria-label="Session setup and tools" data-testid="session-menu">
          <div className="lsv-menu-grid">
            <fieldset className="lsv-group" disabled={ended}>
              <legend>Input</legend>
              {p.onInputModeChange && (
                <div className="lsv-seg" role="radiogroup" aria-label="Input mode">
                  {([["computer", "Computer call"], ["phone", "Phone on speaker"]] as const).map(([v, t]) => (
                    <button key={v} type="button" role="radio" aria-checked={(p.inputMode ?? "computer") === v} data-testid={`button-input-${v}`}
                      onClick={() => p.onInputModeChange?.(v)}>{t}</button>
                  ))}
                </div>
              )}
              {!phone && (
                <>
                  <select aria-label="Audio source" className="lsv-select" data-testid="select-audio-source" value={source} disabled={lockAudio || ended} title={lockAudio ? "Stop audio before changing" : undefined}
                    onChange={(e) => p.onAudioSourceChange(e.target.value as AudioSource)}>
                    <option value="microphone">Microphone</option>
                    <option value="system">{window.sonoraDesktop ? "Call audio" : "Meeting tab"}</option>
                    {p.supportsDualAudio && <option value="both">Both</option>}
                  </select>
                  <label className="lsv-check" title={lockAudio ? "Stop audio before changing" : undefined}>
                    <input type="checkbox" data-testid="checkbox-remote-confirmed" checked={p.remoteConfirmed} disabled={lockAudio || ended}
                      onChange={(e) => p.onRemoteConfirmedChange(e.target.checked)} />
                    Mic = me · call = interviewer
                  </label>
                  <label className="lsv-check">
                    <input type="checkbox" checked={p.microphoneAuto} disabled={ended}
                      onChange={e => p.onMicrophoneAutoChange(e.target.checked)} />
                    Also answer microphone questions (may include me)
                  </label>
                  {window.sonoraDesktop && source !== "microphone" && p.onSystemDeviceChange && (
                    <CallOutputPicker value={p.systemDevice ?? ""} onChange={p.onSystemDeviceChange} disabled={lockAudio} />
                  )}
                </>
              )}
              {phone && <p className="lsv-note">Phone mode uses the laptop microphone only. Mic and call-output mapping is not used.</p>}
              {lockAudio && <p className="lsv-note">Stop audio before changing input.</p>}
            </fieldset>

            <div className="lsv-group">
              <span className="lsv-legend">Answers</span>
              {p.onAutoAnswerChange && !ended && !phone && (
                <button type="button" className="lsv-btn" data-testid="button-auto-answer" aria-pressed={autoOn} onClick={() => p.onAutoAnswerChange?.(!autoOn)}>
                  Auto Answer: {autoOn ? "on, turn off" : "off, turn on"}
                </button>
              )}
              <button type="button" className="lsv-btn" data-testid="button-preferences" onClick={p.onPreferences}>
                <Settings2 size={13} aria-hidden="true" /> Answer settings
              </button>
              {phone && live && p.onPhoneAutoChange && <label className="lsv-check">
                <input type="checkbox" data-testid="checkbox-phone-auto-live" checked={!!p.phoneAuto} disabled={!p.phoneConsent || ended}
                  onChange={e => p.onPhoneAutoChange?.(e.target.checked)} />
                Answer automatically from mixed audio. This can answer your own questions and misfire.
              </label>}
              {p.onReadiness && <button type="button" className="lsv-btn" data-testid="button-readiness" onClick={p.onReadiness}>Readiness</button>}
              {phone && p.onAnswerRecentShortcutChange && (
                <label className="lsv-check">Answer recent shortcut
                  <select className="lsv-select" aria-label="Answer recent shortcut" data-testid="select-answer-recent-shortcut" value={shortcut}
                    onChange={(e) => p.onAnswerRecentShortcutChange?.(e.target.value as "alt-enter" | "ctrl-shift-enter")}>
                    <option value="alt-enter">Alt+Enter</option>
                    <option value="ctrl-shift-enter">Ctrl/Cmd+Shift+Enter</option>
                  </select>
                </label>
              )}
              {phone && <p className="lsv-note">Works only while Sonora is focused. It is not a global shortcut.</p>}
            </div>

            {(p.nativeControls || p.maintenanceControls) && <div className="lsv-group">
              <span className="lsv-legend">Window and screen sharing</span>
              <div className="lsv-native">{p.nativeControls}</div>
              {p.maintenanceControls}
            </div>}

            <div className="lsv-group" data-testid="live-status">
              <span className="lsv-legend">Diagnostics</span>
              <span className={`lsv-chip ${live ? "ok" : ""}`}>{live ? "Capture started" : "Audio off"}</span>
              {!phone && <span className={`lsv-chip ${autoOn && p.remoteConfirmed && source !== "microphone" ? "ok" : "warn"}`}>
                Auto Answer {autoOn ? (source === "microphone" && !p.microphoneAuto ? "mic opt-in needed" : p.microphoneAuto ? "on, call + mic" : "on, call audio") : "off"}
              </span>}
              {p.pipelineStatus && <span className="lsv-chip" role="status" data-testid="text-pipeline-status">{p.pipelineStatus}</span>}
              {p.onClaimSpeaker && p.pipelineStatus?.startsWith("Speaker ") && <button type="button" className="lsv-btn" onClick={p.onClaimSpeaker}>This speaker is me</button>}
              {p.onRecordVoice && <button type="button" className="lsv-btn" disabled={live || p.voiceRecording} onClick={p.onRecordVoice}>{p.voiceRecording ? "Listening…" : p.voiceReady ? "Record my voice again" : "Record my voice"}</button>}
              {p.voiceReady && p.onClearVoice && <button type="button" className="lsv-btn" onClick={p.onClearVoice}>Clear saved voice</button>}
              {p.onScreenshot && <button type="button" className="lsv-btn" onClick={p.onScreenshot}>Send screenshot</button>}
              {p.timingSummary && <span className="lsv-chip" data-testid="text-timing-summary">{p.timingSummary}</span>}
              {p.channelStatus && <span className="lsv-chip">{phone ? `Laptop mic: ${p.channelStatus.microphone}` : `Mic: ${p.channelStatus.microphone} · Call: ${p.channelStatus.system}`}</span>}
              {p.levels && live && (phone ? <Meter name="Mixed" value={p.levels.microphone} /> : <><Meter name="Mic" value={p.levels.microphone} /><Meter name="Call" value={p.levels.system} /></>)}
              {hint && <span className="lsv-hint">{hint}</span>}
            </div>
          </div>
          <div className="lsv-menu-foot">
            <button type="button" className="lsv-btn" data-testid="button-back" onClick={p.onBack}><ArrowLeft size={13} aria-hidden="true" /> Sessions</button>
            <button type="button" className="lsv-btn" data-testid="button-end-session" disabled={ended} onClick={p.onEnd}>End session</button>
          </div>
        </div>
      )}

      {(p.error || p.notice) && (
        <div className={`lsv-banner ${p.error ? "err" : ""}`} role={p.error ? "alert" : "status"} data-testid="live-message">
          {p.error || p.notice}
          {p.error && p.onRetry && state === "interrupted" && <button type="button" className="lsv-btn" onClick={p.onRetry}>Retry</button>}
          {p.error && live && <button type="button" className="lsv-btn" onClick={() => setMenuOpen(true)}>Open setup</button>}
        </div>
      )}

      {phone && !live && !ended && (
        <div className="lsv-banner lsv-phone" data-testid="phone-setup">
          <strong>Phone on speaker.</strong> Sonora listens through this laptop microphone. Both voices are mixed into one stream and Sonora cannot reliably tell who is speaking. Nothing starts until you press Start.
          <label className="lsv-check"><input type="checkbox" data-testid="checkbox-phone-consent" checked={!!p.phoneConsent} disabled={!p.onPhoneConsentChange} onChange={(e) => p.onPhoneConsentChange?.(e.target.checked)} />
            I understand and have the right to capture this audio.</label>
          <label className="lsv-check"><input type="checkbox" data-testid="checkbox-phone-auto" checked={!!p.phoneAuto} disabled={!p.phoneConsent || !p.onPhoneAutoChange} onChange={(e) => p.onPhoneAutoChange?.(e.target.checked)} />
            Also answer automatically from mixed audio. Warning: this can answer your own questions and misfire.</label>
        </div>
      )}

      <CaptureDiagnostics events={p.captureDiagnostics ?? []} />
      {phone && live && !ended && (
        <div className="lsv-phone-live" data-testid="phone-live-strip">
          <span className="lsv-chip warn">Mixed audio, speaker unknown{p.phoneAuto ? "" : " · manual answers"}</span>
          {p.phoneAuto && p.onPhoneAutoChange && <button type="button" className="lsv-btn" data-testid="button-pause-phone-auto" onClick={() => p.onPhoneAutoChange?.(false)}>Pause auto</button>}
          <button type="button" className="lsv-btn" data-testid="button-show-recent" aria-expanded={recentOpen} onClick={() => setRecentOpen((v) => !v)}>Recent</button>
          <button type="button" className="lsv-btn lsv-primary" data-testid="button-answer-recent" disabled={!canRecent} title={shortcutLabel} onClick={() => p.onAnswerRecent?.()}>Answer recent</button>
          {recentOpen && <div className="lsv-recent" data-testid="text-recent-phone">{recent || "Nothing recognized yet."}</div>}
        </div>
      )}

      {showAutoBanner && (
        <div className={`lsv-note-bar ${autoReady && live ? "ok" : ""}`} role="status" data-testid="auto-answer-setup">
          {hint}
          {!lockAudio && autoOn && source === "microphone" && (
            <button type="button" data-testid="button-use-call-audio" className="lsv-link" onClick={() => p.onAudioSourceChange("system")}>Share meeting tab</button>
          )}
          {!lockAudio && autoOn && source !== "microphone" && !p.remoteConfirmed && (
            <label className="lsv-check">
              <input type="checkbox" data-testid="checkbox-confirm-interviewer" checked={false} onChange={(e) => p.onRemoteConfirmedChange(e.target.checked)} />
              Label my microphone as Candidate (meeting audio is Interviewer)
            </label>
          )}
          {!autoOn && p.onAutoAnswerChange && (
            <button type="button" data-testid="button-enable-auto-answer" className="lsv-link" onClick={() => p.onAutoAnswerChange?.(true)}>Turn on Auto Answer</button>
          )}
          {lockAudio && <span>Stop audio before changing the source.</span>}
        </div>
      )}

      <div className={`lsv-body ${txOpen ? "has-tx" : ""}`}>
        <section className="lsv-pane lsv-answer-pane" aria-label="Answer help">
          <header>
            <span>Answer</span>
            <em className={state === "interrupted" || state === "streaming" ? "lsv-label partial" : "lsv-label"} data-testid="text-answer-state">
              {working || state === "interrupted" ? stateLabel :
                live && p.pipelineStatus?.includes("Transcribing") ? "Transcribing speech" :
                live && p.pipelineStatus?.includes("Collecting") ? "Listening for the question" :
                state === "complete" ? "Answer ready" : live ? "Listening" : stateLabel}
            </em>
          </header>
          <FollowLatestPane resetKey={p.session.id} label="Answer help" testId="answer-pane" jumpTestId="jump-to-latest-answer">
            {p.latestQuestion && <div className="lsv-q"><b>Question:</b> {p.latestQuestion}</div>}
            {working && <div className="lsv-meta" role="status">{state === "streaming" ? "Streaming now." : "Waiting for the answer."} The previous one stays below until replaced.</div>}
            {shownAnswer ? (
              <SafeMarkdown className="lsv-answer" testId="text-current-answer" text={shownAnswer} />
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
                if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (canAsk) p.onAsk(); }
              }} />
            <button type="submit" className="lsv-btn lsv-primary" data-testid="button-ask" disabled={!canAsk} title="Ctrl/Cmd+Enter">
              <Send size={13} aria-hidden="true" /> {working ? "Working" : "Ask"}
            </button>
            <button type="button" className="lsv-btn" data-testid="button-toggle-transcript" aria-expanded={txOpen} onClick={() => setTxOpen((v) => !v)}>
              {txOpen ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />} Transcript
            </button>
          </form>
        </section>

        {txOpen && <TranscriptPane sessionId={p.session.id} spoken={spoken} interim={p.interimTranscript} live={live} phone={phone} onUse={p.onUseTranscript} />}
      </div>
    </section>
  );
}
