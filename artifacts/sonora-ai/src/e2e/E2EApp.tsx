import { useEffect, useState } from "react";
import type { CallSession, TranscriptEntry } from "@workspace/api-client-react";
import DesktopVisibilityControls from "@/components/desktop-visibility-controls";
import DesktopSessions from "@/components/desktop-sessions";
import DesktopLiveOverlay from "@/components/desktop-live-overlay";
import { requestAnswer } from "@/lib/answer-stream";
import { readSonoraTheme, type SonoraTheme } from "@/lib/theme";

type Mode = "ok" | "401" | "500" | "timeout" | "offline" | "speechmatics";

function blank(partial: Partial<CallSession> & Pick<CallSession, "id" | "title">): CallSession {
  return {
    sessionType: "interview", company: partial.company ?? null, description: "", resumeText: "", documentsText: "",
    instructions: "", answerPreference: "balanced", model: "e2e", language: "English", autoAnswer: true,
    saveTranscript: true, status: "ready", transcript: [], createdAt: new Date().toISOString(),
    startedAt: null, endedAt: null, ...partial,
  };
}

export default function E2EApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "interview" | "call" | "mock">("all");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);
  const [listening, setListening] = useState(false);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState("");
  const [question, setQuestion] = useState("");
  const [latest, setLatest] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [formError, setFormError] = useState("");
  const [theme, setTheme] = useState<SonoraTheme>(() => readSonoraTheme());
  const [lastClick, setLastClick] = useState("idle");
  const [audioSource, setAudioSource] = useState<"microphone" | "system" | "both">("system");
  const selected = sessions.find(session => session.id === selectedId) ?? null;
  const visible = sessions.filter(session => (filter === "all" || session.sessionType === filter) &&
    `${session.title} ${session.company ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest("button, a, summary, input, label");
      const name = control?.getAttribute("aria-label") || control?.textContent || "panel";
      setLastClick(name.replace(/\s+/g, " ").trim().slice(0, 80) || "panel");
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const onTranscript = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text?.trim() || "";
      if (!text) return;
      setInterim("");
      setEntries(current => [...current, { role: "user", text, source: "system", createdAt: new Date().toISOString() }]);
    };
    window.addEventListener("sonora-e2e-transcript", onTranscript);
    return () => window.removeEventListener("sonora-e2e-transcript", onTranscript);
  }, []);

  const refresh = async () => {
    const response = await fetch("/api/sessions", { credentials: "include" });
    if (response.status === 401) { setSignedIn(false); return; }
    const data = await response.json() as CallSession[];
    setSessions(data);
    setSignedIn(true);
  };

  const signIn = async () => {
    const response = await fetch("/api/e2e/sign-in", { method: "POST", credentials: "include" });
    if (!response.ok) { setError("Sign-in failed."); return; }
    await refresh();
  };

  const ask = async (text: string) => {
    const clean = text.trim();
    if (!clean || !selected) {
      setError("Nothing to answer yet. Click Listen so Sonora can hear the question, or type one in Chat.");
      return;
    }
    setError("");
    setLatest(clean);
    try {
      const result = await requestAnswer(selected.id, { question: clean, action: "answer" }, AbortSignal.timeout(4000), setAnswer);
      setAnswer(result.answer);
      setHistory(current => current.includes(result.answer) ? current : [...current, result.answer]);
      setNotice("");
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      const message = cause instanceof Error ? cause.message : "Answer failed.";
      setError(name === "TimeoutError" || /timeout|aborted/i.test(message)
        ? "Answer timed out. Sonora is still open; retry when you are connected."
        : /failed to fetch|network|offline/i.test(message)
          ? "Network offline. Sonora is still open; retry when you are connected."
          : message);
    }
  };

  const listen = async () => {
    if (!selected) return;
    if (listening) { setListening(false); setNotice("Audio transcription stopped."); return; }
    try {
      const response = await fetch(`/api/sessions/${selected.id}/live-audio`, { credentials: "include" });
      if (response.status === 503) { setError(""); setNotice("Speechmatics unavailable. Using Gemini fallback for transcription."); }
      else if (!response.ok) setError("Live transcription could not start.");
      else {
        const body = await response.json().catch(() => ({})) as { transcript?: string };
        const heard = body.transcript?.trim();
        if (heard) setEntries(current => [...current, { role: "user", text: heard, source: "system", createdAt: new Date().toISOString() }]);
        setError("");
        setNotice("Listening. Speechmatics is connected.");
      }
      setListening(true);
    } catch {
      setError("Network offline. Sonora is still open; retry when you are connected.");
    }
  };

  const create = async () => {
    if (!company.trim()) { setFormError("Add a company or paste the job description."); return; }
    const response = await fetch("/api/sessions", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `${company.trim()} interview`, company: company.trim(), sessionType: filter === "mock" ? "mock" : "interview" }),
    });
    if (!response.ok) { setFormError("Could not create the session."); return; }
    setCreateOpen(false); setCompany(""); setFormError("");
    await refresh();
  };

  return (
    <>
      <DesktopVisibilityControls />
      <p id="sonora-last-click" aria-label={lastClick} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>{lastClick}</p>
      <main className="sonora-workspace dp-app text-[#e7e8eb]">
        {!signedIn ? (
          <section className="dp-glass dp-card" aria-label="Signed out">
            <h1>You are signed out</h1>
            <p>Connect Sonora before starting a session.</p>
            <button type="button" className="dp-primary" data-testid="button-sign-in" onClick={() => void signIn()}>Sign in</button>
            {error && <p role="alert">{error}</p>}
          </section>
        ) : live && selected ? (
          <DesktopLiveOverlay
            session={selected}
            answer={answer}
            assistantAnswers={history}
            latestQuestion={latest}
            question={question}
            onQuestionChange={setQuestion}
            onAsk={text => void ask(text)}
            onShowAnswer={next => { setAnswer(next); setError(""); }}
            onClearAnswers={() => { setAnswer(""); setLatest(""); setQuestion(""); setError(""); setNotice("Visible answers cleared."); }}
            onClearTranscript={() => { setEntries([]); setInterim(""); setNotice("Visible transcript cleared."); }}
            interim={interim}
            entries={entries}
            listening={listening}
            level={listening ? 0.4 : 0}
            duration="00:10"
            notice={notice}
            error={error}
            onEnd={() => { setLive(false); setListening(false); setNotice("Session ended."); }}
            onBack={() => { setLive(false); setListening(false); }}
            onToggleAudio={() => void listen()}
            onScreenshot={() => void (async () => {
              const image = await window.sonoraDesktop?.captureScreen?.();
              if (!image) { setError("Screenshot was not captured."); return; }
              await ask(latest || question || "Explain what is visible in this screenshot.");
              setNotice("Screenshot attached.");
            })()}
            onPreferences={() => setNotice("Answer settings")}
            onReadiness={() => setNotice("Readiness")}
            audioSource={audioSource}
            onAudioSourceChange={setAudioSource}
            autoAnswer
            onAutoAnswerChange={() => setNotice("Auto Answer toggled")}
          />
        ) : (
          <DesktopSessions
            sessions={visible}
            allSessions={sessions}
            filter={filter}
            onFilter={setFilter}
            search={search}
            onSearch={setSearch}
            onCreate={() => { setFormError(""); setCreateOpen(true); }}
            onMock={() => { setFilter("mock"); setFormError(""); setCreateOpen(true); }}
            onJoin={session => { setSelectedId(session.id); setLive(true); setEntries([]); setAnswer(""); setHistory([]); setQuestion(""); setLatest(""); setError(""); setNotice(""); }}
            onView={session => setSelectedId(session.id)}
            selected={selected}
            creditText="12 credits left"
            userEmail="sai@sonora.ai"
            onSignOut={() => { setSignedIn(false); setLive(false); setSessions([]); }}
            theme={theme}
            onTheme={next => { setTheme(next); document.documentElement.dataset.sonoraTheme = next; }}
            now={Date.now()}
            role="user"
            freeSessionsUsed={0}
            unlimitedUntilMs={null}
            upgradeHref="/pricing"
          />
        )}
        {createOpen && (
          <div className="dp-backdrop fixed" role="presentation" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 20 }}>
            <form className="dp-glass dp-dialog" role="dialog" aria-label="Create session" onSubmit={event => { event.preventDefault(); void create(); }} style={{ width: 420, padding: 20 }}>
              <h2>Create Session</h2>
              <label htmlFor="e2e-company">Company</label>
              <input id="e2e-company" aria-label="Company" value={company} onChange={event => setCompany(event.target.value)} />
              {formError && <p role="alert">{formError}</p>}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" onClick={() => { setCreateOpen(false); setFormError(""); }}>Cancel</button>
                <button type="submit">Create session</button>
              </div>
            </form>
          </div>
        )}
      </main>
    </>
  );
}

export type { Mode };
