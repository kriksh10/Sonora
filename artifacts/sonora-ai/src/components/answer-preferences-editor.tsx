import { useMemo, useState } from "react";
import type { AnswerPreferences } from "@workspace/api-client-react";
import {
  DEFAULT_ANSWER_PREFERENCES, EXAMPLE_QUESTIONS, QUESTION_TYPES, renderPreview, saveDefaultPreferences, type QuestionType,
} from "@/lib/answer-preferences";

const FORMATS = [
  ["full_script", "Full script", "An answer you can read word for word."],
  ["script_bullets", "Script + bullets", "Opening line, then supporting bullets."],
  ["bullet_points", "Bullet points", "Short bullets you can say in your own words."],
] as const;
const LENGTHS = [
  ["short", "Short", "Quick answer with only the essentials."],
  ["balanced", "Balanced", "Core answer with useful context."],
  ["long", "Long", "More explanation and supporting detail."],
] as const;
const TONES = [
  ["simple", "Simple", "Plain words, no jargon"],
  ["formal", "Formal", "Precise, professional wording"],
] as const;

function Choice<T extends string>({ name, options, value, onChange }: {
  name: string; options: readonly (readonly [T, string, string])[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2">
      {options.map(([id, title, hint]) => (
        <button type="button" role="radio" aria-checked={value === id} key={id} onClick={() => onChange(id)}
          data-testid={`pref-${name.toLowerCase()}-${id}`}
          className={`rounded-xl border px-3 py-2.5 text-left transition ${value === id ? "border-emerald-400/60 bg-emerald-500/10" : "border-white/10 bg-[#191a1d] hover:bg-white/5"}`}>
          <span className="block text-sm font-medium text-white">{title}</span>
          <span className="block text-xs text-white/45">{hint}</span>
        </button>
      ))}
    </div>
  );
}

function Switch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#191a1d] px-3 py-2.5 text-left">
      <span><span className="block text-sm font-medium text-white">{label}</span><span className="block text-xs text-white/45">{hint}</span></span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-emerald-500" : "bg-white/20"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

export default function AnswerPreferencesEditor({ initial, saveLabel = "Save", onSave, onBack }: {
  initial: AnswerPreferences; saveLabel?: string; onSave: (value: AnswerPreferences) => void | Promise<void>; onBack: () => void;
}) {
  const [draft, setDraft] = useState<AnswerPreferences>(initial);
  const [type, setType] = useState<QuestionType>("Behavioral");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [working, setWorking] = useState<"default" | "save" | null>(null);
  const preview = useMemo(() => renderPreview(type, draft), [type, draft]);
  const patch = (value: Partial<AnswerPreferences>) => { setDraft((d) => ({ ...d, ...value })); setStatus(null); };

  const setDefault = async () => {
    if (working) return;
    setWorking("default"); setStatus(null);
    try { await saveDefaultPreferences(draft); setStatus({ kind: "ok", text: "Saved as your default for future sessions. Existing sessions are unchanged." }); }
    catch (cause) { setStatus({ kind: "error", text: cause instanceof Error ? cause.message : "Could not save your default." }); }
    finally { setWorking(null); }
  };
  const save = async () => {
    if (working) return;
    setWorking("save"); setStatus(null);
    try { await onSave(draft); }
    catch (cause) { setStatus({ kind: "error", text: cause instanceof Error ? cause.message : "Could not save." }); setWorking(null); }
  };

  return (
    <fieldset disabled={working !== null} onKeyDown={(e) => { if (e.key === "Escape" && working) e.stopPropagation(); }} className="min-w-0 border-0 p-0">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-white">Answer preferences</h2>
        <button type="button" onClick={onBack} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/5" data-testid="button-prefs-back">Back</button>
      </div>
      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <div className="grid content-start gap-4">
          <div><div className="text-sm font-semibold">How should answers be presented?</div><p className="mb-2 text-xs text-white/45">Choose the format that fits how you want to answer.</p><Choice name="Format" options={FORMATS} value={draft.format} onChange={(format) => patch({ format })} /></div>
          <div><div className="text-sm font-semibold">How long should answers be?</div><p className="mb-2 text-xs text-white/45">Shorter answers appear faster during live calls.</p><Choice name="Length" options={LENGTHS} value={draft.length} onChange={(length) => patch({ length })} />
</div>
          <div><div className="text-sm font-semibold">Tone</div><p className="mb-2 text-xs text-white/45">Choose the wording style.</p><Choice name="Tone" options={TONES} value={draft.tone} onChange={(tone) => patch({ tone })} /></div>
          <Switch label="Enable STAR method" hint="Situation, Task, Action, Result. Applies to behavioral and experience questions." checked={draft.starMethod} onChange={(starMethod) => patch({ starMethod })} />
          <Switch label="Use filler words" hint="Add natural spoken hesitations." checked={draft.fillerWords} onChange={(fillerWords) => patch({ fillerWords })} />
        </div>
        <div className="min-w-0">
          <label className="mb-2 block text-sm font-semibold" htmlFor="preview-type">Preview question type</label>
          <select id="preview-type" value={type} onChange={(e) => setType(e.target.value as QuestionType)} className="mb-3 w-full rounded-lg border border-white/10 bg-[#191a1d] px-3 py-2.5 text-sm text-white">
            {QUESTION_TYPES.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <div className="rounded-xl border border-white/10 bg-[#0c0d0f] p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Illustrative example, not a live Gemini answer</div>
            <p className="mb-3 text-sm text-white"><span className="font-semibold">Question: </span>{EXAMPLE_QUESTIONS[type]}</p>
            <div className="mb-1 text-xs font-semibold text-white/60">Answer</div>
            <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap pr-1 text-sm leading-6 text-white/75" tabIndex={0} aria-label="Answer preview" data-testid="text-answer-preview">{preview}</div>
          </div>
        </div>
      </div>
      {status && <p role={status.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-lg px-3 py-2 text-sm ${status.kind === "error" ? "bg-red-500/10 text-red-200" : "bg-emerald-500/10 text-emerald-100"}`}>{status.text}</p>}
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          <button type="button" disabled={working !== null} onClick={() => { setDraft(DEFAULT_ANSWER_PREFERENCES); setStatus(null); }} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">Standard values</button>
          <button type="button" disabled={working !== null} onClick={() => void setDefault()} data-testid="button-set-default" className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white hover:bg-white/5 disabled:opacity-50">{working === "default" ? "Saving…" : "Set default"}</button>
        </div>
        <button type="button" disabled={working !== null} onClick={() => void save()} data-testid="button-prefs-save" className="rounded-xl bg-[#f0f1f3] px-5 py-2.5 text-sm font-semibold text-[#151619] hover:bg-white disabled:opacity-50">{working === "save" ? "Saving…" : saveLabel}</button>
      </div>
    </fieldset>
  );
}
