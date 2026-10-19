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
  const [uploading, setUploading] = useState<"resume" | "documents" | null>(null);
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
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const target = targetRef.current;
    setUploading(target); setFormError("");
    try {
      const joined = (await Promise.all(files.map(extractFileText))).join("\n\n").slice(0, 40_000);
      if (!joined.trim()) throw new Error("No selectable text was found. Paste the text below instead.");
      setDraft((d) => target === "resume"
        ? { ...d, resumeText: joined }
        : { ...d, documentsText: [d.documentsText, joined].filter(Boolean).join("\n\n").slice(0, 40_000) });
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not read that file."); }
    finally { setUploading(null); }
  };
  const pick = (target: "resume" | "documents") => { targetRef.current = target; fileRef.current?.click(); };

  const create = async () => {
    if (creating || !prefs || !validate()) return;
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

  const textArea = (id: string, label: string, key: "resumeText" | "documentsText", target: "resume" | "documents") => (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold">{label} <span className="font-normal text-white/40">(Optional)</span></label>
        <button type="button" disabled={uploading !== null} onClick={() => pick(target)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50">
          <Upload size={13} /> {uploading === target ? "Reading…" : "Upload PDF, TXT, MD"}
        </button>
      </div>
      <textarea id={id} value={draft[key]} onChange={(e) => set(key, e.target.value.slice(0, 40_000))} className={`${field} min-h-24`} placeholder="Paste text here or upload a file. Only its text is used." />
    </div>
  );

  return (
    <Modal label="Create session" onClose={onClose} busy={creating} focusKey={step} width={step === "answers" ? "max-w-[900px]" : "max-w-[760px]"}>
      <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" multiple className="hidden" onChange={upload} />
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
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"><X size={20} /></button>
          </div>

          {step === "details" ? <>
            <div className="mb-2 text-sm font-semibold">Session type</div>
            <div role="radiogroup" aria-label="Session type" className="mb-5 grid grid-cols-2 rounded-xl bg-[#242528] p-1">
              {(["interview", "call"] as const).map((type) => (
                <button type="button" role="radio" aria-checked={draft.sessionType === type} key={type} data-testid={`button-type-${type}`}
                  onClick={() => { set("sessionType", type); setErrors({}); }}
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
              <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/5">Cancel</button>
              <button type="button" data-testid="button-wizard-next" disabled={uploading !== null} onClick={() => { if (validate()) setStep("preferences"); }} className="rounded-xl bg-[#f0f1f3] px-4 py-3 text-sm font-semibold text-[#151619] hover:bg-white disabled:opacity-50">Next</button>
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
              <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/5">Cancel</button>
              <button type="button" onClick={() => setStep("details")} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/5">Back</button>
              <button type="button" data-testid="button-create-session" disabled={creating || !prefs} onClick={() => void create()} className="rounded-xl bg-[#f0f1f3] px-4 py-3 text-sm font-semibold text-[#151619] hover:bg-white disabled:opacity-50">{creating ? "Creating…" : "Create session"}</button>
            </div>
          </>}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
