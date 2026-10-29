import { useEffect, useRef, useState } from "react";
import { Camera, Eraser, MessageSquare, Timer } from "lucide-react";
import type { CallSession } from "@workspace/api-client-react";
import { apiRequest } from "@/lib/answer-preferences";
import { BILLING_BLOCK_MINUTES, FREE_SESSION_MINUTES } from "@/lib/pricing";
import {
  captureDisplayFrame,
  downloadPdf,
  downloadText,
  generateQuestionBank,
  generateSessionNotes,
  nextMockQuestion,
  readAutoExtend,
  readNotes,
  saveAutoExtend,
  scoreMockAnswer,
  tailorResume,
  type BankItem,
  type SessionNotes,
} from "@/lib/session-tools";

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const body = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${hours}:${body}` : body;
}

export function SessionTimer({ startedAt, now }: { startedAt: string | null; now: number }) {
  const elapsed = startedAt ? now - new Date(startedAt).getTime() : 0;
  const blockMs = BILLING_BLOCK_MINUTES * 60 * 1000;
  const intoBlock = elapsed > 0 ? elapsed % blockMs : 0;
  const remaining = elapsed > 0 ? blockMs - intoBlock : blockMs;
  const freeLeft = Math.max(0, FREE_SESSION_MINUTES * 60 * 1000 - elapsed);
  return (
    <div className="studio-timer" aria-live="polite">
      <Timer size={14} />
      <strong>{startedAt ? clock(elapsed) : "00:00"}</strong>
      <span>{startedAt ? `${clock(remaining)} left in this 30-min block` : "Timer starts when the session starts"}</span>
      {startedAt && freeLeft > 0 && <span>{clock(freeLeft)} left in the free 10 minutes</span>}
    </div>
  );
}

export function CreditsCounter({ label }: { label: string }) {
  return <span className="credits-counter" data-testid="text-credits">{label}</span>;
}

export function creditLabel(input: { bypass: boolean; balance: number; freeRemaining: number; unlimitedUntil: string | null }) {
  if (input.bypass) return "Credits: unlimited";
  if (input.unlimitedUntil && new Date(input.unlimitedUntil).getTime() > Date.now()) return "Credits: pass active";
  return `Credits: ${input.balance} · ${input.freeRemaining} free sessions left`;
}

export default function SessionStudio({
  session,
  now,
  onAsk,
  onClear,
  onUseScreenshot,
  busy = false,
}: {
  session: CallSession;
  now: number;
  onAsk: (question: string) => Promise<string | undefined>;
  onClear: () => void;
  onUseScreenshot: (image: string, question: string) => Promise<string | undefined>;
  busy?: boolean;
}) {
  const [chat, setChat] = useState("");
  const [thread, setThread] = useState<{ role: "you" | "sonora"; text: string }[]>([]);
  const [autoExtend, setAutoExtend] = useState(() => readAutoExtend(session.id));
  const [notes, setNotes] = useState<SessionNotes | null>(() => readNotes(session.id));
  const [notesBusy, setNotesBusy] = useState(false);
  const [bank, setBank] = useState<BankItem[]>([]);
  const [bankBusy, setBankBusy] = useState(false);
  const [resume, setResume] = useState(session.resumeText);
  const [tailored, setTailored] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [mockQuestion, setMockQuestion] = useState("");
  const [mockAnswer, setMockAnswer] = useState("");
  const [mockFeedback, setMockFeedback] = useState("");
  const [mockScore, setMockScore] = useState<number | null>(null);
  const [mockBusy, setMockBusy] = useState(false);
  const [toolError, setToolError] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const ended = session.status === "ended";
  const locked = ended || busy || chatBusy;
  const notesAttempt = useRef<string | null>(null);
  const [savedToolsLoaded, setSavedToolsLoaded] = useState(false);

  useEffect(() => {
    setAutoExtend(readAutoExtend(session.id));
    setNotes(readNotes(session.id));
    setResume(session.resumeText);
    setThread([]);
    setMockQuestion("");
    setMockFeedback("");
    setMockScore(null);
  }, [session.id, session.resumeText]);

  useEffect(() => {
    let cancelled = false;
    setSavedToolsLoaded(false);
    setBank([]);
    Promise.all([
      apiRequest<SessionNotes | null>(`/sessions/${session.id}/notes`),
      apiRequest<BankItem[]>(`/sessions/${session.id}/question-bank`),
      apiRequest<{ autoExtend: boolean }>(`/sessions/${session.id}/billing`),
    ]).then(([savedNotes, savedBank, billing]) => {
      if (cancelled) return;
      setNotes(savedNotes); setBank(savedBank); setAutoExtend(billing.autoExtend); setSavedToolsLoaded(true);
    }).catch(() => { if (!cancelled) setToolError("Saved preparation tools could not be loaded. Reload to retry."); });
    return () => { cancelled = true; };
  }, [session.id]);

  useEffect(() => {
    if (!savedToolsLoaded || session.status !== "ended" || notes || notesAttempt.current === `${session.id}:${session.roundNumber}`) return;
    notesAttempt.current = `${session.id}:${session.roundNumber}`;
    setNotesBusy(true);
    void generateSessionNotes(session).then(setNotes).catch((cause) => {
      setToolError(cause instanceof Error ? cause.message : "Notes could not be written.");
    }).finally(() => setNotesBusy(false));
  }, [session, notes, savedToolsLoaded]);

  const sendChat = async () => {
    const text = chat.trim();
    if (!text || locked) return;
    setThread((items) => [...items, { role: "you", text }]);
    setChat("");
    setChatBusy(true); setToolError("");
    try {
      const reply = await onAsk(text);
      if (reply) setThread(items => [...items, { role: "sonora", text: reply }]);
      else setToolError("No reply was completed. Check the session error and retry.");
    } catch (cause) { setToolError(cause instanceof Error ? cause.message : "Chat failed. Try again."); }
    finally { setChatBusy(false); }
  };

  return (
    <div className="session-studio">
      <p className="text-xs text-white/60">Credit accounting is in preview. No live payments or automatic charges.</p>
      <SessionTimer startedAt={session.startedAt} now={now} />
      <label className="studio-extend">
        <input
          type="checkbox"
          checked={autoExtend}
          onChange={(event) => {
            setAutoExtend(event.target.checked);
            const checked = event.target.checked;
            void saveAutoExtend(session.id, checked).catch(() => {
              setAutoExtend(!checked); setToolError("Auto-extend could not be saved.");
            });
          }}
        />
        Auto-extend in 30-minute credit blocks
      </label>
      <div className="studio-actions">
        <button type="button" disabled={locked} onClick={async () => {
          setChatBusy(true); setToolError("");
          try {
            const image = await captureDisplayFrame();
            if (!image) { setToolError("No screenshot was captured."); return; }
            setThread(items => [...items, { role: "you", text: "Help with this screenshot." }]);
            const reply = await onUseScreenshot(image, "Look at this screenshot and help with the coding or on-screen question.");
            if (reply) setThread(items => [...items, { role: "sonora", text: reply }]);
            else setToolError("Screenshot answer failed. Check the session error and retry.");
          } catch { setToolError("Screen capture was cancelled or could not be analyzed."); }
          finally { setChatBusy(false); }
        }}>
          <Camera size={14} /> Screenshot
        </button>
        <button type="button" disabled={locked} onClick={() => { setThread([]); setChat(""); setToolError(""); onClear(); }}>
          <Eraser size={14} /> Clear
        </button>
      </div>
      {ended && <p role="status">Chat, Screenshot and Clear are unavailable on ended sessions. Restart the interview for another round to use live tools.</p>}
      <section className="studio-card" aria-label="Chat">
        <h3><MessageSquare size={14} /> Chat</h3>
        <div className="studio-thread">
          {thread.length === 0 && <p>Ask anything about this session. Sonora uses the job description, resume, and transcript.</p>}
          {thread.map((item, index) => <p key={index}><strong>{item.role === "you" ? "You" : "Sonora"}:</strong> {item.text}</p>)}
        </div>
        <div className="studio-row">
          <textarea disabled={locked} value={chat} onChange={(event) => setChat(event.target.value)} placeholder="Ask a free-form question" aria-label="Chat message"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendChat(); }
            }} />
          <button type="button" disabled={locked || !chat.trim()} onClick={() => void sendChat()}>{chatBusy ? "Replying…" : "Send"}</button>
        </div>
      </section>
      {session.sessionType === "mock" && (
        <section className="studio-card" aria-label="Mock interview">
          <h3>Mock interview</h3>
          <button type="button" disabled={mockBusy} onClick={() => {
            setMockBusy(true); setToolError("");
            void nextMockQuestion(session).then(setMockQuestion).catch((cause) => setToolError(cause instanceof Error ? cause.message : "Could not ask a question.")).finally(() => setMockBusy(false));
          }}>{mockBusy ? "Working…" : "Ask me a question"}</button>
          {mockQuestion && <p className="studio-question">{mockQuestion}</p>}
          <textarea value={mockAnswer} onChange={(event) => setMockAnswer(event.target.value)} placeholder="Type your answer, or paste what you said" aria-label="Mock answer" />
          <button type="button" disabled={mockBusy || !mockQuestion || !mockAnswer.trim()} onClick={() => {
            setMockBusy(true);
            void scoreMockAnswer(session, mockQuestion, mockAnswer).then((result) => {
              setMockFeedback(result.feedback);
              setMockScore(result.score);
            }).catch((cause) => setToolError(cause instanceof Error ? cause.message : "Could not score the answer.")).finally(() => setMockBusy(false));
          }}>Get feedback and score</button>
          {mockScore !== null && <p>Score: {mockScore}/100</p>}
          {mockFeedback && <p>{mockFeedback}</p>}
        </section>
      )}
      {session.status === "ended" && (
        <section className="studio-card" aria-label="Session notes">
          <h3>Notes</h3>
          {notesBusy && <p>Writing notes…</p>}
          {notes && (
            <>
              <p><strong>Summary.</strong> {notes.summary}</p>
              <p><strong>Questions asked.</strong> {notes.questionsAsked || "None captured."}</p>
              <p><strong>Next steps.</strong> {notes.nextSteps || "None captured."}</p>
            </>
          )}
        </section>
      )}
      <section className="studio-card" aria-label="Question bank">
        <h3>Question bank</h3>
        <button type="button" disabled={bankBusy} onClick={() => {
          setBankBusy(true);
          void generateQuestionBank(session).then(setBank).catch((cause) => setToolError(cause instanceof Error ? cause.message : "Could not build the question bank.")).finally(() => setBankBusy(false));
        }}>{bankBusy ? "Writing questions…" : "Generate likely questions"}</button>
        {bank.map((item) => (
          <article key={item.question}>
            <p><strong>{item.question}</strong></p>
            <p>{item.modelAnswer}</p>
          </article>
        ))}
      </section>
      <section className="studio-card" aria-label="Resume maker">
        <h3>Resume maker</h3>
        <textarea value={resume} onChange={(event) => setResume(event.target.value)} aria-label="Resume text" placeholder="Paste the resume to tailor" />
        <div className="studio-row">
          <button type="button" disabled={resumeBusy || !resume.trim()} onClick={() => {
            setResumeBusy(true);
            void tailorResume(session, resume).then(setTailored).catch((cause) => setToolError(cause instanceof Error ? cause.message : "Could not tailor the resume.")).finally(() => setResumeBusy(false));
          }}>{resumeBusy ? "Tailoring…" : "Tailor to this job"}</button>
          <button type="button" disabled={!tailored} onClick={() => downloadText("sonora-resume.txt", tailored)}>Download text</button>
          <button type="button" disabled={!tailored} onClick={() => downloadPdf("sonora-resume.pdf", tailored)}>Download PDF</button>
        </div>
        {tailored && <pre className="studio-resume">{tailored}</pre>}
      </section>
      {toolError && <p role="alert">{toolError}</p>}
    </div>
  );
}
