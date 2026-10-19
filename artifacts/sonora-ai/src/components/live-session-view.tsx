import { useMemo, type ReactNode } from "react";
import { ArrowLeft, Mic, Send, Settings2, Square } from "lucide-react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import FollowLatestPane from "@/components/follow-latest-pane";
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
};

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

  return (
    <section data-testid="live-session-view" aria-label={`Live session: ${p.session.title}`} className={`lsv-root ${live ? "lsv-live" : ""}`}>
      <div className="lsv-bar desktop-drag" role="toolbar" aria-label="Live session controls">
        <span className="lsv-grip" aria-hidden="true"><i /><i /></span>
        <div className="lsv-title">
          <strong>{p.session.title}</strong>
          <span>{p.session.company || (p.session.sessionType === "interview" ? "Interview" : "Call")} · {!p.session.autoAnswer ? "Auto-answer off" : !p.remoteConfirmed ? "Auto-answer paused" : "Auto-answer: remote only"}</span>
        </div>
        <div className="lsv-controls">
          <span className="lsv-timer" aria-label={`Elapsed ${p.duration}`}><i className="lsv-dot" />{p.duration}</span>
          <select
            aria-label="Audio source"
            className="lsv-select"
            data-testid="select-audio-source"
            value={source}
            disabled={lockAudio}
            onChange={(e) => p.onAudioSourceChange(e.target.value as AudioSource)}
          >
            <option value="microphone">Microphone</option>
            <option value="system" disabled={!window.sonoraDesktop}>Call audio{!window.sonoraDesktop ? " (desktop only)" : ""}</option>
            {p.supportsDualAudio && <option value="both">Both</option>}
          </select>
          <label className="lsv-check">
            <input
              type="checkbox"
              data-testid="checkbox-remote-confirmed"
              checked={p.remoteConfirmed}
              disabled={lockAudio}
              onChange={(e) => p.onRemoteConfirmedChange(e.target.checked)}
            />
            Mic = me · call = interviewer
          </label>
          <button
            type="button"
            data-testid="button-toggle-audio"
            className={`lsv-btn ${live ? "lsv-stop" : "lsv-primary"}`}
            disabled={ended}
            onClick={p.onToggleAudio}
          >
            {live ? <Square size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
            {p.requestingAudio ? "Cancel request" : live ? "Stop audio" : "Start audio"}
          </button>
          <button type="button" className="lsv-btn" data-testid="button-preferences" onClick={p.onPreferences}>
            <Settings2 size={13} aria-hidden="true" /> Answer settings
          </button>
          <button type="button" className="lsv-btn" data-testid="button-end-session" disabled={ended} onClick={p.onEnd}>End</button>
          <button type="button" className="lsv-btn" data-testid="button-back" onClick={p.onBack}>
            <ArrowLeft size={13} aria-hidden="true" /> Sessions
          </button>
          {p.nativeControls}
        </div>
      </div>

      {(p.error || p.notice) && (
        <div className={`lsv-banner ${p.error ? "err" : ""}`} role={p.error ? "alert" : "status"} data-testid="live-message">
          {p.error || p.notice}
        </div>
      )}

      <div className="lsv-body">
        <section className="lsv-pane" aria-label="Transcript">
          <header>
            <span>Transcript</span>
            <em>{live ? "Audio is transcribed in about six-second chunks" : "Audio off"}</em>
          </header>
          <FollowLatestPane resetKey={p.session.id} label="Live transcript" testId="transcript-pane">
            {spoken.length === 0 && !p.interimTranscript && (
              <div className="lsv-empty">
                <strong>{live ? "Listening. Nothing transcribed yet." : "No transcript yet."}</strong>
                {live
                  ? "Text appears after each roughly six-second chunk is processed, so expect a short delay."
                  : "Press Start audio, or type a question in the answer pane."}
              </div>
            )}
            {spoken.map((e, i) => {
              const l = labelFor(e, p.remoteConfirmed);
              return (
                <div className="lsv-entry" key={`${e.createdAt}-${i}`}>
                  <div className="lsv-meta">
                    <span className={`lsv-who ${l.cls}`}>{l.text}</span>
                    <span>{time(e.capturedAt || e.createdAt)}</span>
                    <button type="button" className="lsv-use" onClick={() => p.onUseTranscript(e.text)}>
                      Use as question
                    </button>
                  </div>
                  <div className="lsv-text">{e.text}</div>
                </div>
              );
            })}
            {p.interimTranscript && (
              <div className="lsv-entry">
                <div className="lsv-meta"><span className="lsv-who unk">Transcribing</span></div>
                <div className="lsv-text lsv-interim">{p.interimTranscript}</div>
              </div>
            )}
          </FollowLatestPane>
        </section>

        <section className="lsv-pane" aria-label="Answer help">
          <header>
            <span>Answer</span>
            <em>{p.busy ? "Generating full answer" : "Full responses, not streamed"}</em>
          </header>
          <FollowLatestPane resetKey={p.session.id} label="Answer help" testId="answer-pane" jumpTestId="jump-to-latest-answer">
            {p.busy && (
              <div className="lsv-meta" role="status">Waiting for the complete answer. The previous one stays below.</div>
            )}
            {shownAnswer ? (
              <div className="lsv-answer" data-testid="text-current-answer">{shownAnswer}</div>
            ) : (
              !p.busy && (
                <div className="lsv-empty">
                  <strong>No answer yet.</strong>
                  Ask below or use a transcript line as the question.
                </div>
              )
            )}
          </FollowLatestPane>
          <form
            className="lsv-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (!p.busy && p.question.trim()) p.onAsk();
            }}
          >
            <textarea
              aria-label="Question"
              data-testid="input-question"
              placeholder="Type a question"
              value={p.question}
              onChange={(e) => p.onQuestionChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!p.busy && p.question.trim()) p.onAsk();
                }
              }}
            />
            <button type="submit" className="lsv-btn lsv-primary" data-testid="button-ask" disabled={p.busy || !p.question.trim()}>
              <Send size={13} aria-hidden="true" /> {p.busy ? "Working" : "Ask"}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}
