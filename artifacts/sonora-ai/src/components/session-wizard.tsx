import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import type { AnswerPreferences, CallSession, NewCallSession } from "@workspace/api-client-react";
import Modal from "@/components/modal";
import AnswerPreferencesEditor from "@/components/answer-preferences-editor";
import { apiRequest, fetchDefaultPreferences, summarizePreferences } from "@/lib/answer-preferences";
import { extractFileText } from "@/lib/extract-file-text";

type Draft = {
  sessionType: "interview" | "call"; company: string; description: string; title: string;
  resumeText: string; documentsText: string; instructions: string;
  model: "gemini-2.5-flash" | "gemini-3-flash-preview"; language: "English" | "Spanish" | "French" | "German";
  autoAnswer: boolean; saveTranscript: boolean;
};
const emptyDraft: Draft = {
  sessionType: "interview", company: "", description: "", title: "", resumeText: "", documentsText: "",
  instructions: "", model: "gemini-2.5-flash", language: "English", autoAnswer: false, saveTranscript: true,
};
const LIMIT = 40_000;
const field = "mt-1.5 w-full rounded-lg border border-white/10 bg-[#191a1d] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25";

export function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-[#191a1d] px-3 py-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-emerald-500" />
      <span><span className="block font-medium text-white">{label}</span>{hint && <span className="block text-xs text-white/45">{hint}</span>}</span>
    </label>
  );
}

export default function SessionWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (session: CallSession) => void }) {
  const [step, setStep] = useState<"details" | "preferences" | "answers">("details");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [prefs, setPrefs] = useState<AnswerPreferences | null>(null);
  const [defaultsError, setDefaultsError] = useState("");
  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [readingResume, setReadingResume] = useState(false);
  const [readingDocs, setReadingDocs] = useState(false);
  const [resumeFile, setResumeFile] = useState("");
  const [pendingName, setPendingName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<"resume" | "documents">("resume");
  const prefsTouched = useRef(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const loadDefaults = useCallback(async () => {
    setLoadingDefaults(true); setDefaultsError("");
    try {
      const value = await fetchDefaultPreferences();
      setPrefs((current) => (prefsTouched.current && current ? current : value));
    } catch (cause) {
      setDefaultsError(cause instanceof Error ? cause.message : "Could not load your default answer preferences.");
    } finally { setLoadingDefaults(false); }
  }, []);
  useEffect(() => { void loadDefaults(); }, [loadDefaults]);

  const interview = draft.sessionType === "interview";
  const validate = () => {
    const next: Record<string, string> = {};
    if (interview && !draft.company.trim() && !draft.description.trim()) next.company = "Add a company or paste the job description.";
    if (interview && draft.resumeText.length > LIMIT) next.resumeText = `Resume is ${draft.resumeText.length.toLocaleString()} characters. Trim it to ${LIMIT.toLocaleString()} or fewer before creating the session.`;
    if (draft.documentsText.length > LIMIT) next.documentsText = `Documents total ${draft.documentsText.length.toLocaleString()} characters. Trim them to ${LIMIT.toLocaleString()} or fewer before creating the session.`;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const resumeVer = useRef(0);
  const docsVer = useRef(0);
  const resumeAbort = useRef<AbortController | null>(null);
  const docsAbort = useRef<AbortController | null>(null);
  const cancelResume = () => { resumeVer.current += 1; resumeAbort.current?.abort(); resumeAbort.current = null; setReadingResume(false); };
  const cancelDocs = () => { docsVer.current += 1; docsAbort.current?.abort(); docsAbort.current = null; setReadingDocs(false); };
  useEffect(() => () => { resumeAbort.current?.abort(); docsAbort.current?.abort(); }, []);
  const close = () => { cancelResume(); cancelDocs(); onClose(); };
  const uploading = readingResume || readingDocs;

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const target = targetRef.current;
    setFormError("");
    if (target === "resume") {
      const file = files[0];
      cancelResume();
      const ver = resumeVer.current;
      const ctrl = new AbortController();
      resumeAbort.current = ctrl;
      setReadingResume(true); setPendingName(file.name);
      try {
        const text = await extractFileText(file, ctrl.signal);
        if (ver !== resumeVer.current) return;
        if (!text.trim()) throw new Error("No selectable text was found. Paste the text below instead.");
        setDraft((d) => ({ ...d, resumeText: text })); setResumeFile(file.name); setErrors((e) => ({ ...e, resumeText: "" }));
      } catch (cause) {
        if (ver !== resumeVer.current) return;
        setFormError(cause instanceof Error ? cause.message : "Could not read that file. Your previous resume text was kept.");
      } finally { if (ver === resumeVer.current) { setReadingResume(false); setPendingName(""); } }
      return;
    }
    cancelDocs();
    const ver = docsVer.current;
    const ctrl = new AbortController();
    docsAbort.current = ctrl;
    setReadingDocs(true);
    try {
      const parts = await Promise.all(files.map((f) => extractFileText(f, ctrl.signal)));
      if (ver !== docsVer.current) return;
      const joined = parts.join("\n\n");
      if (!joined.trim()) throw new Error("No selectable text was found. Paste the text below instead.");
      setDraft((d) => ({ ...d, documentsText: [d.documentsText, joined].filter(Boolean).join("\n\n") }));
      setErrors((e) => ({ ...e, documentsText: "" }));
    } catch (cause) {
      if (ver !== docsVer.current) return;
      setFormError(cause instanceof Error ? cause.message : "Could not read that file.");
    } finally { if (ver === docsVer.current) setReadingDocs(false); }
  };
  const pick = (target: "resume" | "documents") => { targetRef.current = target; if (fileRef.current) fileRef.current.multiple = target === "documents"; fileRef.current?.click(); };
  const removeResume = () => { cancelResume(); setResumeFile(""); setPendingName(""); setFormError(""); set("resumeText", ""); setErrors((e) => ({ ...e, resumeText: "" })); };
  const edit = (key: "resumeText" | "documentsText", value: string) => {
    if (key === "resumeText") cancelResume(); else cancelDocs();
    set(key, value);
    if (value.length <= LIMIT) setErrors((e) => ({ ...e, [key]: "" }));
  };

  const create = async () => {
    if (creating || uploading || !prefs) return;
    if (!validate()) { setStep("details"); return; }
    setCreating(true); setFormError("");
    const body: NewCallSession = {
      sessionType: draft.sessionType,
      title: draft.title.trim(),
      company: interview ? draft.company.trim() : "",
      description: draft.description.trim(),
      documentsText: draft.documentsText,
      instructions: draft.instructions,
      answerPreferences: prefs,
      model: draft.model, language: draft.language,
      autoAnswer: draft.autoAnswer, saveTranscript: draft.saveTranscript,
      ...(interview ? { resumeText: draft.resumeText } : {}),
    };
    try {
      const created = await apiRequest<CallSession>("/sessions", { method: "POST", body: JSON.stringify(body) });
      onCreated(created);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not create session."); setCreating(false); }
  };

  const textArea = (id: string, label: string, key: "resumeText" | "documentsText", target: "resume" | "documents") => {
    const reading = target === "resume" ? readingResume : readingDocs;
    const count = draft[key].length;
    const over = count > LIMIT;
    const fileName = target === "resume" ? (reading ? pendingName : resumeFile) : "";
    return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold">{label} <span className="font-normal text-white/40">(Optional)</span></label>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => pick(target)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5">
            <Upload size={13} /> {target === "resume" && (resumeFile || reading) ? "Replace file" : target === "resume" ? "Upload DOCX, DOC, PDF, TXT" : "Upload files"}
          </button>
          {target === "resume" && (resumeFile || reading) && <button type="button" data-testid="button-remove-resume" onClick={removeResume} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5">Remove</button>}
        </div>
      </div>
      {fileName && <div className="mt-1.5 flex items-center gap-2 text-xs text-white/55" aria-live="polite"><span className="truncate font-medium text-white/75">{fileName}</span>{reading ? <span className="text-emerald-300">Reading…</span> : <span>Extracted. Review and edit below.</span>}</div>}
      {target === "documents" && reading && <div className="mt-1.5 text-xs text-emerald-300" aria-live="polite">Reading…</div>}
      <textarea id={id} value={draft[key]} onChange={(e) => edit(key, e.target.value)} aria-invalid={over} className={`${field} ${fileName ? "min-h-40" : "min-h-24"} ${over ? "border-red-400/50" : ""}`} placeholder="Paste text here or upload a file. Only its text is used." />
      <div className="mt-1 flex items-start justify-between gap-3 text-xs">
        <span>{errors[key] && <span role="alert" className="text-red-300">{errors[key]}</span>}</span>
        <span className={`shrink-0 tabular-nums ${over ? "text-red-300" : "text-white/40"}`}>{count.toLocaleString()} / {LIMIT.toLocaleString()}</span>
      </div>
    </div>
  ); };

  return (
    <Modal label="Create session" onClose={close} busy={creating} focusKey={step} width={step === "answers" ? "max-w-[900px]" : "max-w-[760px]"}>
      <input ref={fileRef} type="file" accept=".docx,.doc,.pdf,.txt,.md,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword" className="hidden" onChange={upload} />
      {step === "answers" && prefs ? (
        <AnswerPreferencesEditor initial={prefs} saveLabel="Select" onBack={() => setStep("preferences")}
          onSave={(value) => { prefsTouched.current = true; setPrefs(value); setStep("preferences"); }} />
      ) : (
        <form onSubmit={(e) => e.preventDefault()} noValidate>
          <fieldset disabled={creating} className="min-w-0 border-0 p-0">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">Create Session</h2>
              <ol className="mt-2 flex gap-4 text-xs text-white/45" aria-label="Steps">
                <li aria-current={step === "details" ? "step" : undefined} className={step === "details" ? "font-semibold text-emerald-300" : ""}>1 Details</li>
                <li aria-current={step === "preferences" ? "step" : undefined} className={step === "preferences" ? "font-semibold text-emerald-300" : ""}>2 Preferences</li>
              </ol>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"><X size={20} /></button>
          </div>

          {step === "details" ? <>
            <div className="mb-2 text-sm font-semibold">Session type</div>
            <div role="radiogroup" aria-label="Session type" className="mb-5 grid grid-cols-2 rounded-xl bg-[#242528] p-1">
              {(["interview", "call"] as const).map((type) => (
                <button type="button" role="radio" aria-checked={draft.sessionType === type} key={type} data-testid={`button-type-${type}`}
                  onClick={() => { if (type !== draft.sessionType) cancelResume(); set("sessionType", type); setErrors({}); }}
                  className={`rounded-lg py-2.5 text-sm font-medium ${draft.sessionType === type ? "bg-[#3a3c41] text-white" : "text-white/50 hover:text-white"}`}>
                  {type === "interview" ? "Interview" : "Regular call"}
                </button>
              ))}
            </div>
            {interview ? (
              <div className="mb-4">
                <label className="text-sm font-semibold" htmlFor="wiz-company">Company</label>
                <input id="wiz-company" data-autofocus value={draft.company} maxLength={200} onChange={(e) => set("company", e.target.value)} aria-invalid={!!errors.company} className={field} placeholder="Company you are interviewing with" />
                {errors.company && <p role="alert" className="mt-1 text-xs text-red-300">{errors.company}</p>}
              </div>
            ) : (
              <div className="mb-4">
                <label className="text-sm font-semibold" htmlFor="wiz-title">Call title</label>
                <input id="wiz-title" data-autofocus value={draft.title} maxLength={200} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title} className={field} placeholder="Optional: weekly sync, client call…" />
                {errors.title && <p role="alert" className="mt-1 text-xs text-red-300">{errors.title}</p>}
              </div>
            )}
            <div className="mb-4">
              <label className="text-sm font-semibold" htmlFor="wiz-desc">{interview ? "Job description" : "Description"} <span className="font-normal text-white/40">(Optional)</span></label>
              <textarea id="wiz-desc" value={draft.description} maxLength={8000} onChange={(e) => set("description", e.target.value)} className={`${field} min-h-28`} placeholder={interview ? "Paste the job description." : "What is this call about?"} />
            </div>
            {interview && textArea("wiz-resume", "CV / Resume", "resumeText", "resume")}
            {textArea("wiz-docs", "Documents", "documentsText", "documents")}
            {formError && <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={close} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/5">Cancel</button>
              <button type="button" data-testid="button-wizard-next" onClick={() => { if (validate()) setStep("preferences"); }} className="rounded-xl bg-[#f0f1f3] px-4 py-3 text-sm font-semibold text-[#151619] hover:bg-white disabled:opacity-50">Next</button>
            </div>
          </> : <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-white/45">Call language
                <select value={draft.language} onChange={(e) => set("language", e.target.value as Draft["language"])} className={field}>
                  {["English", "Spanish", "French", "German"].map((l) => <option key={l}>{l}</option>)}
                </select></label>
              <label className="text-xs text-white/45">Gemini model
                <select value={draft.model} onChange={(e) => set("model", e.target.value as Draft["model"])} className={field}>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option><option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                </select></label>
            </div>
            <div className="mb-4 rounded-xl border border-white/10 bg-[#191a1d] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="font-semibold">Answer preferences</div>
                  {loadingDefaults ? <div className="text-xs text-white/45">Loading your defaults…</div>
                    : prefs ? <div className="truncate text-xs text-white/50" data-testid="text-prefs-summary">{summarizePreferences(prefs)}</div>
                    : <div className="text-xs text-red-300">Defaults unavailable.</div>}
                </div>
                <button type="button" disabled={!prefs} onClick={() => setStep("answers")} data-testid="button-configure-answers" className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50">Configure</button>
              </div>
              {defaultsError && <div role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200"><span>{defaultsError}</span><button type="button" onClick={() => void loadDefaults()} className="shrink-0 font-semibold underline">Retry</button></div>}
            </div>
            <div className="mb-1 flex items-center justify-between"><label className="text-sm font-semibold" htmlFor="wiz-instr">AI instructions <span className="font-normal text-white/40">(Optional)</span></label><button type="button" onClick={() => set("instructions", "")} className="text-xs text-white/55 hover:text-white">Clear</button></div>
            <textarea id="wiz-instr" value={draft.instructions} maxLength={8000} onChange={(e) => set("instructions", e.target.value)} className={`${field} mb-4 min-h-24 mt-0`} placeholder="Extra guidance for every answer." />
            <div className="mb-5 grid gap-2">
              <SwitchRow label="Auto-generate answers (Beta)" hint="Answer detected questions automatically." checked={draft.autoAnswer} onChange={(v) => set("autoAnswer", v)} />
              <SwitchRow label="Save transcript" hint="Only record transcripts where everyone has consented." checked={draft.saveTranscript} onChange={(v) => set("saveTranscript", v)} />
            </div>
            {formError && <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</p>}
            <div className="grid grid-cols-3 gap-3">
              <button type="button" onClick={close} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/5">Cancel</button>
              <button type="button" onClick={() => setStep("details")} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/5">Back</button>
              <button type="button" data-testid="button-create-session" disabled={creating || uploading || !prefs} onClick={() => void create()} className="rounded-xl bg-[#f0f1f3] px-4 py-3 text-sm font-semibold text-[#151619] hover:bg-white disabled:opacity-50">{creating ? "Creating…" : uploading ? "Reading file…" : "Create session"}</button>
            </div>
          </>}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
