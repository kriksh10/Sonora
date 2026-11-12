import { useState } from "react";
import { ChevronLeft, FileText, LogOut, Mic, Plus, Search } from "lucide-react";
import type { CallSession } from "@workspace/api-client-react";
import { creditsForSession } from "@/lib/pricing";

type Filter = "all" | "interview" | "call" | "mock";
type Panel = "sessions" | "resumes" | "documents" | "transcript";

function kind(session: CallSession) {
  if (session.sessionType === "mock") return "Mock";
  return session.sessionType === "interview" ? "Interview" : "Regular";
}

function minutes(session: CallSession, now: number) {
  if (!session.startedAt) return 0;
  const end = session.status === "ended" && session.endedAt ? new Date(session.endedAt).getTime() : now;
  return Math.max(0, (end - new Date(session.startedAt).getTime()) / 60000);
}

function lengthLabel(session: CallSession, now: number) {
  const total = Math.round(minutes(session, now) * 60);
  if (!session.startedAt) return "—";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DesktopSessions(props: {
  sessions: CallSession[];
  allSessions: CallSession[];
  filter: Filter;
  onFilter: (value: Filter) => void;
  search: string;
  onSearch: (value: string) => void;
  onCreate: () => void;
  onMock: () => void;
  onJoin: (session: CallSession) => void;
  onView: (session: CallSession) => void;
  selected: CallSession | null;
  creditText: string;
  userEmail?: string;
  onSignOut: () => void;
  theme: "light" | "dark";
  onTheme: (theme: "light" | "dark") => void;
  now: number;
  role: string;
  freeSessionsUsed: number;
  unlimitedUntilMs: number | null;
  upgradeHref: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<Panel>("sessions");
  const live = props.allSessions.some(session => session.status === "active");
  const active = props.sessions.filter(session => session.status !== "ended");
  const past = props.sessions.filter(session => session.status === "ended");
  const resumes = props.allSessions.filter(session => session.resumeText?.trim());
  const documents = props.allSessions.filter(session => session.documentsText?.trim());

  const credits = (session: CallSession) => creditsForSession({
    role: props.role,
    freeSessionsUsed: props.freeSessionsUsed,
    elapsedMinutes: minutes(session, props.now),
    unlimitedUntilMs: props.unlimitedUntilMs,
    nowMs: props.now,
  }).credits;

  const row = (session: CallSession) => (
    <tr key={session.id}>
      <td><strong>{session.title || "Untitled session"}</strong><div style={{ color: "rgba(255,255,255,.5)", fontSize: 12 }}>{session.company || "—"}</div></td>
      <td>{kind(session)}</td>
      <td>{lengthLabel(session, props.now)}</td>
      <td>{session.startedAt ? credits(session) : "—"}</td>
      <td>{new Date(session.createdAt).toLocaleDateString()}</td>
      <td><span className={`dp-chip ${session.status === "active" ? "live" : session.status === "ended" ? "ended" : "ready"}`}>{session.status === "active" ? "Live" : session.status === "ended" ? "Ended" : "Ready"}</span></td>
      <td>
        {session.status === "ended"
          ? <button className="dp-row-btn" onClick={() => { props.onView(session); setPanel("transcript"); }}>View transcript</button>
          : <button className="dp-row-btn" onClick={() => props.onJoin(session)}>{session.status === "active" ? "Join" : "Start"}</button>}
      </td>
    </tr>
  );

  return (
    <div className="dp-home">
      <aside className={`dp-glass dp-side ${collapsed ? "is-collapsed" : ""}`} aria-label="Sonora">
        <div className="dp-brand">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          {!collapsed && <strong>Sonora</strong>}
          <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(value => !value)}><ChevronLeft size={16} style={{ transform: collapsed ? "rotate(180deg)" : undefined }} /></button>
        </div>
        {!collapsed && <div className="dp-label">Interview Assistant</div>}
        <button className="dp-nav-btn" onClick={props.onCreate}><Plus size={15} />{!collapsed && "Create session"}</button>
        <button className={`dp-nav-btn ${panel === "sessions" ? "is-active" : ""}`} onClick={() => setPanel("sessions")}><Mic size={15} />{!collapsed && "Call Sessions"}{!collapsed && live && <span className="dp-live-badge">Live</span>}</button>
        <button className={`dp-nav-btn ${panel === "resumes" ? "is-active" : ""}`} onClick={() => setPanel("resumes")}><FileText size={15} />{!collapsed && "Resumes"}</button>
        <button className={`dp-nav-btn ${panel === "documents" ? "is-active" : ""}`} onClick={() => setPanel("documents")}><FileText size={15} />{!collapsed && "Documents"}</button>
        {!collapsed && <div className="dp-label">Prepare</div>}
        <button className="dp-nav-btn" onClick={props.onMock}><Mic size={15} />{!collapsed && "Mock Interview"}</button>
        {!collapsed && <div className="dp-side-foot">
          <div className="dp-plan">
            <div style={{ marginBottom: 8 }}>{props.creditText}</div>
            <a href={props.upgradeHref}>Upgrade</a>
          </div>
          <div className="dp-tabs" style={{ margin: 0 }}>
            <button type="button" aria-pressed={props.theme === "dark"} className={props.theme === "dark" ? "is-active" : ""} onClick={() => props.onTheme("dark")}>Dark</button>
            <button type="button" aria-pressed={props.theme === "light"} className={props.theme === "light" ? "is-active" : ""} onClick={() => props.onTheme("light")}>Light</button>
          </div>
          <div className="dp-user"><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{props.userEmail || "Signed in"}</span><button type="button" aria-label="Log out" onClick={props.onSignOut}><LogOut size={14} /></button></div>
        </div>}
      </aside>
      <section className="dp-glass dp-main" aria-label="Call Sessions">
        {panel === "resumes" || panel === "documents" ? (
          <>
            <div className="dp-head"><div><h1>{panel === "resumes" ? "Resumes" : "Documents"}</h1><p>Text saved on your Sonora sessions. Nothing here is shared.</p></div></div>
            <div className="dp-list">
              {(panel === "resumes" ? resumes : documents).map(session => (
                <article key={session.id}><strong>{session.title}</strong><p>{panel === "resumes" ? session.resumeText : session.documentsText}</p></article>
              ))}
              {(panel === "resumes" ? resumes : documents).length === 0 && <p>Nothing saved yet. Add it when you create a session.</p>}
            </div>
          </>
        ) : panel === "transcript" && props.selected ? (
          <>
            <div className="dp-head"><div><h1>{props.selected.title}</h1><p>Saved transcript. This does not start audio.</p></div><button className="dp-row-btn" onClick={() => setPanel("sessions")}>Back</button></div>
            <div className="dp-list">
              {props.selected.transcript.length === 0 && <p>No transcript was saved for this session.</p>}
              {props.selected.transcript.map((entry, index) => (
                <article key={`${entry.createdAt}-${index}`}><strong>{entry.role === "assistant" ? "Sonora" : entry.speaker || entry.source}</strong><p>{entry.text}</p></article>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="dp-head">
              <div>
                <h1>Call Sessions</h1>
                <p>Prepare, join a live call, and review what Sonora heard.</p>
              </div>
              <button className="dp-primary" onClick={props.onCreate}><Plus size={15} /> Create session</button>
            </div>
            <div className="dp-tabs" role="tablist" aria-label="Session type">
              {([["all", "All"], ["interview", "Interview"], ["call", "Regular"], ["mock", "Mock"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={props.filter === id} className={props.filter === id ? "is-active" : ""} onClick={() => props.onFilter(id)}>{label}</button>
              ))}
            </div>
            <div className="dp-tools">
              <Search size={14} />
              <input className="dp-search" aria-label="Search sessions" value={props.search} placeholder="Search sessions" onChange={event => props.onSearch(event.target.value)} />
              <span>{props.sessions.length} {props.sessions.length === 1 ? "session" : "sessions"}</span>
            </div>
            <div className="dp-table-wrap">
              <table className="dp-table">
                <thead><tr><th>Session</th><th>Mode</th><th>Duration</th><th>Credits used</th><th>Created</th><th>State</th><th></th></tr></thead>
                <tbody>
                  <tr className="dp-group"><td colSpan={7}>Active</td></tr>
                  {active.map(row)}
                  {active.length === 0 && <tr><td colSpan={7}>No active sessions.</td></tr>}
                  <tr className="dp-group"><td colSpan={7}>Past</td></tr>
                  {past.map(row)}
                  {past.length === 0 && <tr><td colSpan={7}>No past sessions.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
