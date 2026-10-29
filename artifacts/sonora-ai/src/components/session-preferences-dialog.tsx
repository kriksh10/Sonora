import { useState } from "react";
import { X } from "lucide-react";
import type { AnswerPreferences, CallSession, SessionPreferencesInput } from "@workspace/api-client-react";
import Modal from "@/components/modal";
import AnswerPreferencesEditor from "@/components/answer-preferences-editor";
import { SwitchRow } from "@/components/session-wizard";
import { apiRequest, sessionPreferences, summarizePreferences } from "@/lib/answer-preferences";
import { CALL_LANGUAGES, type CallLanguage } from "@/lib/call-languages";
import { GEMINI_MODELS, resolveGeminiModel } from "@/lib/pricing";

const field = "mt-1.5 w-full rounded-lg border border-white/10 bg-[#191a1d] px-3 py-2.5 text-sm text-white outline-none focus:border-white/25";
const LANGS = CALL_LANGUAGES.map(language => language.name);

export default function SessionPreferencesDialog({ session, onClose, onSaved }: {
  session: CallSession; onClose: () => void; onSaved: (session: CallSession) => void;
}) {
  const [instructions, setInstructions] = useState(session.instructions);
  const [model, setModel] = useState(resolveGeminiModel(session.model));
  const [language, setLanguage] = useState<CallLanguage>(CALL_LANGUAGES.find((item) => item.name === session.language)?.name ?? "English");
  const [autoAnswer, setAutoAnswer] = useState(session.autoAnswer);
  const [saveTranscript, setSaveTranscript] = useState(session.saveTranscript);
  const [prefs, setPrefs] = useState<AnswerPreferences>(() => sessionPreferences(session));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (saving) return;
    setSaving(true); setError("");
    const body: SessionPreferencesInput = { answerPreferences: prefs, instructions, model, language, autoAnswer, saveTranscript };
    try {
      const updated = await apiRequest<CallSession>(`/sessions/${session.id}/preferences`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save preferences."); setSaving(false); }
  };

  return (
    <Modal label="Edit preferences" onClose={onClose} busy={saving} focusKey={editing ? "answers" : "main"} width={editing ? "max-w-[900px]" : "max-w-[640px]"}>
      {editing ? (
        <AnswerPreferencesEditor initial={prefs} saveLabel="Select" onBack={() => setEditing(false)} onSave={(v) => { setPrefs(v); setEditing(false); }} />
      ) : (
        <fieldset disabled={saving} className="min-w-0 border-0 p-0">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-tight text-white">Edit preferences</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"><X size={20} /></button>
          </div>
          <p className="mb-4 text-xs text-white/45">Changes apply to later answers in {session.title}. The session status and history are not changed.</p>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-white/45">Call language
              <select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)} className={field}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="text-xs text-white/45">Gemini model
              <select value={model} onChange={(e) => setModel(resolveGeminiModel(e.target.value))} className={field}>
                {GEMINI_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          </div>
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#191a1d] p-3">
            <div className="min-w-0 text-sm"><div className="font-semibold">Answer preferences</div>
              <div className="truncate text-xs text-white/50">{summarizePreferences(prefs)}</div></div>
            <button type="button" onClick={() => setEditing(true)} data-testid="button-edit-answer-prefs" className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">Configure</button>
          </div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="edit-instr" className="text-sm font-semibold">AI instructions</label>
            <button type="button" onClick={() => setInstructions("")} className="text-xs text-white/55 hover:text-white">Clear</button>
          </div>
          <textarea id="edit-instr" data-autofocus value={instructions} maxLength={8000} onChange={(e) => setInstructions(e.target.value)} className={`${field} mb-4 mt-0 min-h-28`} />
          <div className="mb-5 grid gap-2">
            <SwitchRow label="Auto-generate answers (Beta)" checked={autoAnswer} onChange={setAutoAnswer} />
            <SwitchRow label="Save transcript" hint="Turning this off stops later transcript saves." checked={saveTranscript} onChange={setSaveTranscript} />
          </div>
          {error && <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/5">Cancel</button>
            <button type="button" disabled={saving} onClick={() => void save()} data-testid="button-save-session-prefs" className="rounded-xl bg-[#f0f1f3] px-4 py-3 text-sm font-semibold text-[#151619] hover:bg-white disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </fieldset>
      )}
    </Modal>
  );
}
