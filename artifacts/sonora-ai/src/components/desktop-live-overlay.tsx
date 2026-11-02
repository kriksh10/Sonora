import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Expand, MoreVertical, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import SafeMarkdown from "@/components/safe-markdown";
import { neighborAnswer } from "@/lib/desktop-commands";

type AudioSource = "microphone" | "system" | "both";

export default function DesktopLiveOverlay(props: {
  session: CallSession;
  answer: string;
  assistantAnswers: string[];
  latestQuestion: string;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
  onShowAnswer: (answer: string) => void;
  onClearAnswers: () => void;
  onClearTranscript: () => void;
  interim: string;
  entries: TranscriptEntry[];
  listening: boolean;
  level: number;
  duration: string;
  notice: string;
  error: string;
  onEnd: () => void;
  onBack: () => void;
  onToggleAudio: () => void;
  onScreenshot?: () => void;
  onPreferences: () => void;
  onReadiness?: () => void;
  audioSource: AudioSource;
  onAudioSourceChange: (value: AudioSource) => void;
  autoAnswer: boolean;
  onAutoAnswerChange?: (value: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [chat, setChat] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(true);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const spoken = [...props.entries].reverse().find(entry => entry.role !== "assistant")?.text || "";
  const liveWords = props.interim || spoken || "Waiting for speech…";
  const previous = neighborAnswer(props.assistantAnswers, props.answer, -1);
  const next = neighborAnswer(props.assistantAnswers, props.answer, 1);
  const headline = props.answer.split("\n").map(line => line.trim()).find(Boolean)?.replace(/^#+\s*/, "") || "No answer yet";

  return (
    <div className="dp-overlay">
      <header className="dp-glass dp-bar">
        <span className="dp-dots" aria-hidden="true"><i className={props.listening ? "on" : ""} /><i className={props.error ? "warn" : props.listening ? "on" : ""} /></span>
        <div className="dp-actions">
          <button className="dp-pill" onClick={props.onAsk}>Answer <kbd>Ctrl+Enter</kbd></button>
          <button className="dp-pill" disabled={!props.onScreenshot} onClick={props.onScreenshot}>Screenshot <kbd>Ctrl+Shift+Enter</kbd></button>
          <button className={`dp-pill ${chat ? "is-active" : ""}`} onClick={() => setChat(value => !value)}>Chat</button>
          <button className="dp-pill" onClick={props.onToggleAudio}>{props.listening ? "Stop listening" : "Listen"}</button>
        </div>
        <div className="dp-drag desktop-drag" title="Drag Sonora" />
        <button className="dp-icon-btn" aria-label={collapsed ? "Expand overlay" : "Collapse overlay"} onClick={() => setCollapsed(value => !value)}><ChevronLeft size={16} /></button>
        <details className="dp-menu">
          <summary className="dp-icon-btn" aria-label="Overlay menu"><MoreVertical size={16} /></summary>
          <div className="dp-glass dp-menu-pop">
            <p style={{ margin: 0 }}>Opacity is the slim slider on the Sonora bar. {Math.round(Number(getComputedStyle(document.documentElement).getPropertyValue("--sonora-background-opacity")) * 100) || 40}% now.</p>
            <label>Audio
              <select aria-label="Audio source" value={props.audioSource} onChange={event => props.onAudioSourceChange(event.target.value as AudioSource)}>
                <option value="microphone">Microphone</option>
                <option value="system">Call audio</option>
                <option value="both">Both</option>
              </select>
            </label>
            {props.onAutoAnswerChange && <button className="dp-pill" onClick={() => props.onAutoAnswerChange?.(!props.autoAnswer)}>Auto Answer {props.autoAnswer ? "on" : "off"}</button>}
            <button className="dp-pill" onClick={props.onPreferences}>Answer settings</button>
            {props.onReadiness && <button className="dp-pill" onClick={props.onReadiness}>Readiness</button>}
            <button className="dp-pill" onClick={props.onClearAnswers}>Clear answers</button>
            <button className="dp-pill" onClick={props.onBack}>Back to sessions</button>
          </div>
        </details>
        <button className="dp-end" onClick={props.onEnd}>End</button>
      </header>
      {chat && (
        <form className="dp-glass dp-chat" onSubmit={event => { event.preventDefault(); props.onAsk(); }}>
          <textarea aria-label="Question" rows={2} value={props.question} placeholder="Type a question" onChange={event => props.onQuestionChange(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onAsk(); } }} />
        </form>
      )}
      {!collapsed && (
        <section className="dp-glass dp-strip" aria-label="Live transcript">
          <span className="dp-level" aria-hidden="true"><b style={{ width: `${Math.round(Math.max(0, Math.min(1, props.level)) * 100)}%` }} /></span>
          {transcriptOpen ? (
            <div className="dp-answer-scroll" style={{ maxHeight: 160 }}>{props.entries.filter(entry => entry.role !== "assistant").map((entry, index) => <div key={index}>{entry.text}</div>)}</div>
          ) : <div className="dp-words">{liveWords}</div>}
          <button className="dp-pill" onClick={props.onClearTranscript}>Clear</button>
          <button className="dp-icon-btn" aria-label={transcriptOpen ? "Collapse transcript" : "Expand transcript"} onClick={() => setTranscriptOpen(value => !value)}><Expand size={14} /></button>
        </section>
      )}
      {!collapsed && answerOpen && (
        <article className="dp-glass dp-card" aria-label="Answer">
          <div className="dp-card-tools">
            <button className="dp-icon-btn" aria-label="Previous answer" disabled={!previous} onClick={() => previous && props.onShowAnswer(previous)}><ChevronLeft size={16} /></button>
            <button className="dp-icon-btn" aria-label="Next answer" disabled={!next} onClick={() => next && props.onShowAnswer(next)}><ChevronRight size={16} /></button>
            <span className="spacer" />
            <button className="dp-pill" onClick={props.onClearAnswers}>Clear</button>
            <button className="dp-icon-btn" aria-label="Hide answer" onClick={() => setAnswerOpen(false)}><X size={14} /></button>
          </div>
          <div className="dp-q"><b>Question:</b> {props.latestQuestion || props.question || "Waiting for a question"} <button type="button" aria-label="Copy question" onClick={() => void navigator.clipboard?.writeText(props.latestQuestion || props.question || "")}><Copy size={13} /></button></div>
          <div className="dp-answer-scroll">
            <h3>Answer: {headline}</h3>
            {props.answer ? <SafeMarkdown text={props.answer} /> : <p>Ask, or let Auto Answer respond when the interviewer finishes.</p>}
          </div>
          {(props.error || props.notice) && <p role="status">{props.error || props.notice}</p>}
          <footer className="dp-foot">
            <span>Answer · {props.duration}</span>
            <span className="spacer" />
            <button type="button" className={vote === "up" ? "is-on" : ""} aria-label="Helpful" aria-pressed={vote === "up"} onClick={() => setVote(vote === "up" ? null : "up")}><ThumbsUp size={14} /></button>
            <button type="button" className={vote === "down" ? "is-on" : ""} aria-label="Not helpful" aria-pressed={vote === "down"} onClick={() => setVote(vote === "down" ? null : "down")}><ThumbsDown size={14} /></button>
          </footer>
        </article>
      )}
      {!collapsed && !answerOpen && <button className="dp-pill" onClick={() => setAnswerOpen(true)}>Show answer</button>}
    </div>
  );
}
