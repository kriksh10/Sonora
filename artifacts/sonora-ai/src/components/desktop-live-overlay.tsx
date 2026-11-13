import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Expand, MoreVertical, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import SafeMarkdown from "@/components/safe-markdown";
import DesktopSelect from "@/components/desktop-select";
import { liveAnswerQuestion } from "@/lib/overlay-hit-test";

type AudioSource = "microphone" | "system" | "both";

export default function DesktopLiveOverlay(props: {
  session: CallSession;
  answer: string;
  assistantAnswers: string[];
  latestQuestion: string;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: (question: string) => void;
  onShowAnswer: (answer: string) => void;
  onClearAnswers: () => void;
  onClearTranscript: () => void;
  interim: string;
  entries: TranscriptEntry[];
  listening: boolean;
  paused?: boolean;
  onPauseToggle?: () => void;
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
  microphoneAuto?: boolean;
  onMicrophoneAutoChange?: (value: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [chat, setChat] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(true);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [copied, setCopied] = useState("");
  const answerPane = useRef<HTMLDivElement>(null);
  const [answerEnd, setAnswerEnd] = useState(true);
  const [answerOverflow, setAnswerOverflow] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const markAnswer = () => {
    const el = answerPane.current;
    if (!el) return;
    const overflow = el.scrollHeight > el.clientHeight + 2;
    setAnswerOverflow(overflow);
    setAnswerEnd(!overflow || el.scrollTop + el.clientHeight >= el.scrollHeight - 8);
    setScrollTop(Math.round(el.scrollTop));
  };
  useEffect(() => { markAnswer(); }, [props.answer]);
  useEffect(() => {
    const toggle = () => setChat(value => !value);
    window.addEventListener("sonora-toggle-chat", toggle);
    return () => window.removeEventListener("sonora-toggle-chat", toggle);
  }, []);
  const spoken = [...props.entries].reverse().find(entry => entry.role !== "assistant")?.text || "";
  const liveWords = props.paused
    ? "Paused. Transcription is off until you resume."
    : props.interim || spoken || (props.listening ? "Listening…" : "Listening is off. Click Listen, or type a question in Chat.");
  const askText = liveAnswerQuestion({ typed: props.question, latest: props.latestQuestion, interim: props.interim, spoken });
  const history = props.assistantAnswers.filter(text => text.trim());
  const at = history.lastIndexOf(props.answer);
  const previous = at > 0 ? history[at - 1] : at < 0 && history.length ? history[history.length - 1] : null;
  const next = at >= 0 && at < history.length - 1 ? history[at + 1] : null;
  const ask = (question: string) => {
    const text = question.trim();
    if (text) props.onAsk(text);
    else props.onAsk("");
  };
  const headline = props.answer.split("\n").map(line => line.trim()).find(Boolean)?.replace(/^#+\s*/, "") || "No answer yet";

  return (
    <div className="dp-overlay">
      <header className="dp-glass dp-bar">
        <span className="dp-dots" aria-hidden="true"><i className={props.listening ? "on" : ""} /><i className={props.error ? "warn" : props.listening ? "on" : ""} /></span>
        <div className="dp-actions">
          <button type="button" className="dp-pill" aria-label="Answer" onClick={() => ask(askText)}>Answer <kbd>Ctrl+Enter</kbd></button>
          <button type="button" className="dp-pill" aria-label="Screenshot" disabled={!props.onScreenshot} onClick={props.onScreenshot}>Screenshot <kbd>Ctrl+Shift+Enter</kbd></button>
          <button type="button" className={`dp-pill ${chat ? "is-active" : ""}`} onClick={() => setChat(value => !value)}>Chat</button>
          <button type="button" className="dp-pill" onClick={props.onToggleAudio}>{props.listening ? "Stop listening" : "Listen"}</button>
          {props.onPauseToggle && (
            <button type="button" className={`dp-pill ${props.paused ? "is-paused" : ""}`} aria-pressed={!!props.paused}
              disabled={!props.listening && !props.paused} onClick={props.onPauseToggle}>{props.paused ? "Resume" : "Pause"}</button>
          )}
        </div>
        <div className="dp-drag desktop-drag" title="Drag Sonora" />
        <button type="button" className="dp-icon-btn" aria-label={collapsed ? "Expand overlay" : "Collapse overlay"} onClick={() => setCollapsed(value => !value)}><ChevronLeft size={16} /></button>
        <details className="dp-menu">
          <summary className="dp-icon-btn" aria-label="Overlay menu"><MoreVertical size={16} /></summary>
          <div className="dp-glass dp-menu-pop">
            <p style={{ margin: 0 }}>Opacity is the slim slider on the Sonora bar. {Math.round(Number(getComputedStyle(document.documentElement).getPropertyValue("--sonora-background-opacity")) * 100) || 40}% now.</p>
            <DesktopSelect
              legend="Audio"
              label="Audio source"
              value={props.audioSource}
              options={[
                { value: "microphone", label: "Microphone" },
                { value: "system", label: "Call audio" },
                { value: "both", label: "Both" },
              ]}
              onChange={value => props.onAudioSourceChange(value as AudioSource)}
            />
            {props.onAutoAnswerChange && <button type="button" className="dp-pill" onClick={() => props.onAutoAnswerChange?.(!props.autoAnswer)}>Auto Answer {props.autoAnswer ? "on" : "off"}</button>}
            {props.onMicrophoneAutoChange && (props.audioSource === "both" || props.audioSource === "microphone") && (
              <button type="button" className="dp-pill" aria-pressed={!!props.microphoneAuto} onClick={() => props.onMicrophoneAutoChange?.(!props.microphoneAuto)}>
                Microphone answers {props.microphoneAuto ? "on" : "off"}
              </button>
            )}
            <p style={{ margin: "8px 0 0" }}>Auto Answer uses call audio. Microphone answers also reply to the mic, which can include your own voice.</p>
            <button type="button" className="dp-pill" onClick={props.onPreferences}>Answer settings</button>
            {props.onReadiness && <button type="button" className="dp-pill" onClick={props.onReadiness}>Readiness</button>}
            <button type="button" className="dp-pill" onClick={props.onClearAnswers}>Clear answers</button>
            <button type="button" className="dp-pill" onClick={props.onBack}>Back to sessions</button>
          </div>
        </details>
        <button type="button" className="dp-end" aria-label="End session" onClick={props.onEnd}>End</button>
      </header>
      {chat && (
        <form className="dp-glass dp-chat" onSubmit={event => { event.preventDefault(); ask(props.question); }}>
          <textarea aria-label="Question" rows={2} value={props.question} placeholder="Type a question" onChange={event => props.onQuestionChange(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(props.question); } }} />
        </form>
      )}
      {!collapsed && (
        <section className="dp-glass dp-strip" aria-label="Live transcript">
          <span className="dp-level" aria-hidden="true"><b style={{ width: `${Math.round(Math.max(0, Math.min(1, props.level)) * 100)}%` }} /></span>
          {transcriptOpen ? (
            <div className="dp-answer-scroll" style={{ maxHeight: 160 }}>{props.entries.filter(entry => entry.role !== "assistant").map((entry, index) => (
              <button type="button" className="dp-line" key={index} onClick={() => ask(entry.text)}>{entry.text}</button>
            ))}</div>
          ) : <button type="button" className="dp-words" onClick={() => ask(spoken || props.interim)}>{liveWords}</button>}
          <button type="button" className="dp-pill" aria-label="Clear transcript" onClick={props.onClearTranscript}>Clear</button>
          <button type="button" className="dp-icon-btn" aria-label={transcriptOpen ? "Collapse transcript" : "Expand transcript"} onClick={() => setTranscriptOpen(value => !value)}><Expand size={14} /></button>
        </section>
      )}
      {!collapsed && answerOpen && (
        <article className="dp-glass dp-card" aria-label="Answer">
          <div className="dp-card-tools">
            <button type="button" className="dp-icon-btn" aria-label="Previous answer" disabled={!previous} onClick={() => previous && props.onShowAnswer(previous)}><ChevronLeft size={16} /></button>
            <button type="button" className="dp-icon-btn" aria-label="Next answer" disabled={!next} onClick={() => next && props.onShowAnswer(next)}><ChevronRight size={16} /></button>
            <span className="spacer" />
            <button type="button" className="dp-pill" aria-label="Clear answer" onClick={props.onClearAnswers}>Clear</button>
            <button type="button" className="dp-icon-btn" aria-label="Hide answer" onClick={() => setAnswerOpen(false)}><X size={14} /></button>
          </div>
          <div className="dp-q"><b>Question:</b> {props.latestQuestion || props.question || "Waiting for a question"} <button type="button" aria-label="Copy question" onClick={() => { const text = props.latestQuestion || props.question || ""; setCopied(text); void navigator.clipboard?.writeText(text).catch(() => {}); }}><Copy size={13} /></button></div>
          {copied && <p role="status">Copied question: {copied}</p>}
          {answerOverflow && <div className="dp-scroll-chevrons">
            <button type="button" aria-label="Scroll answer up" onClick={() => answerPane.current?.scrollBy({ top: -200 })}>↑</button>
            <button type="button" aria-label="Scroll answer down" onClick={() => answerPane.current?.scrollBy({ top: 200 })}>↓</button>
          </div>}
          <p className="sonora-scroll-status" aria-label={`Answer scroll position ${scrollTop}`}>Answer scroll position {scrollTop}</p>
          <div ref={answerPane} className="dp-answer-scroll" tabIndex={0} onScroll={markAnswer} aria-label={props.answer ? (answerEnd ? "Answer end visible" : "Answer scrollable") : "Answer pending"}>
            <h3>Answer: {headline}</h3>
            {props.answer ? <SafeMarkdown text={props.answer} /> : <p>Ask, or let Auto Answer respond when the interviewer finishes.</p>}
          </div>
          {props.error && <p role="alert">{props.error}</p>}
          {props.notice && <p role="status">{props.notice}</p>}
          <footer className="dp-foot">
            <span>Answer · {props.duration}</span>
            <span className="spacer" />
            <button type="button" className={vote === "up" ? "is-on" : ""} aria-label={vote === "up" ? "Helpful selected" : "Helpful"} aria-pressed={vote === "up"} onClick={() => setVote(vote === "up" ? null : "up")}><ThumbsUp size={14} /></button>
            <button type="button" className={vote === "down" ? "is-on" : ""} aria-label={vote === "down" ? "Not helpful selected" : "Not helpful"} aria-pressed={vote === "down"} onClick={() => setVote(vote === "down" ? null : "down")}><ThumbsDown size={14} /></button>
          </footer>
        </article>
      )}
      {!collapsed && !answerOpen && <button type="button" className="dp-pill" onClick={() => setAnswerOpen(true)}>Show answer</button>}
    </div>
  );
}
