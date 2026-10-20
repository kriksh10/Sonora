import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createAudioGroup, createDesktopAudio, type AudioCapture } from "@/lib/desktop-audio";
import { requestAnswer } from "@/lib/answer-stream";

export default function AudioReadiness({ sessionId, onClose, answerBusy, supportsDualAudio }: {
  sessionId: string; onClose: () => void; answerBusy: boolean; supportsDualAudio: boolean;
}) {
  const [source, setSource] = useState<"microphone" | "system" | "both">(window.sonoraDesktop && supportsDualAudio ? "both" : "microphone");
  const [phase, setPhase] = useState<"off" | "starting" | "on">("off");
  const [levels, setLevels] = useState({ microphone: 0, system: 0 });
  const [states, setStates] = useState({ microphone: "Not checked", system: "Not checked" });
  const [seen, setSeen] = useState({ microphone: false, system: false });
  const [error, setError] = useState("");
  const [testAnswer, setTestAnswer] = useState("");
  const [testing, setTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const captures = useRef<AudioCapture | null>(null);
  const token = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const stop = () => {
    ++token.current;
    clearTimeout(timeout.current);
    captures.current?.stop(); captures.current = null;
    if (mounted.current) { setPhase("off"); setLevels({ microphone: 0, system: 0 }); }
  };
  useEffect(() => {
    mounted.current = true;
    const off = window.sonoraDesktop?.onStopCapture(stop);
    window.addEventListener("sonora-stop-audio", stop);
    return () => { mounted.current = false; off?.(); window.removeEventListener("sonora-stop-audio", stop); stop(); abort.current?.abort(); };
  }, []);
  const start = async () => {
    if (phase !== "off") { stop(); return; }
    const mine = ++token.current;
    setPhase("starting"); setError(""); setSeen({ microphone: false, system: false });
    const sources: ("microphone" | "system")[] = source === "both" ? ["microphone", "system"] : [source];
    const group = createAudioGroup(sources.map(channel => createDesktopAudio({
      source: channel, sessionId, transcribe: false, onText() {}, onNotice() {},
      onLevel: (level, state) => {
        if (!mounted.current || mine !== token.current) return;
        setLevels(value => ({ ...value, [channel]: level }));
        setStates(value => ({ ...value, [channel]: state }));
        if (level > .003) setSeen(value => ({ ...value, [channel]: true }));
      },
      onError: cause => { if (mine === token.current && mounted.current) { stop(); setError(cause.message); } },
    })));
    captures.current = group;
    try {
      await group.start();
      if (mine !== token.current || !mounted.current) { group.stop(); return; }
      setPhase("on");
      setStates(value => Object.fromEntries(Object.entries(value).map(([key, state]) =>
        [key, sources.includes(key as "microphone" | "system") ? "Waiting for activity" : state])) as typeof value);
      timeout.current = setTimeout(() => { stop(); if (mounted.current) setError("Audio check stopped after 45 seconds. Activity results remain below; start session audio separately."); }, 45000);
    } catch (cause) {
      if (mine !== token.current || !mounted.current) return;
      stop(); setError(cause instanceof Error ? cause.message : "Audio check failed.");
    }
  };
  const testGemini = async () => {
    if (testing || answerBusy) return;
    const controller = new AbortController();
    abort.current = controller; setTesting(true); setTestPassed(false); setTestAnswer(""); setError("");
    try {
      const result = await requestAnswer(sessionId, { question: "For this connectivity test, briefly explain what an API is in one sentence.", test: true },
        AbortSignal.any([controller.signal, AbortSignal.timeout(95000)]),
        text => { if (mounted.current && !controller.signal.aborted) setTestAnswer(text); });
      if (mounted.current && !controller.signal.aborted) { setTestAnswer(result.answer); setTestPassed(true); }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Gemini check failed.");
    } finally { if (mounted.current) setTesting(false); }
  };
  return <Dialog open onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-[#15171a] text-white sm:max-w-lg">
      <DialogTitle>Pre-interview check</DialogTitle>
      <DialogDescription className="text-white/60">Check devices and Gemini before the call. Passing this check does not start your session or enable Auto Answer.</DialogDescription>
      <div className="space-y-4 text-sm">
        <p className="text-white/65">Wear headphones. Speak to test your mic; play call audio to test the remote channel. Activity confirms a source, not a person’s identity.</p>
        <label className="block">Audio source
          <select aria-label="Readiness audio source" disabled={phase !== "off"} value={source}
            onChange={e => setSource(e.target.value as typeof source)} className="ml-3 rounded border border-white/20 bg-[#22252a] p-2">
            <option value="microphone">Microphone</option>
            {window.sonoraDesktop && <option value="system">Call audio</option>}
            {window.sonoraDesktop && supportsDualAudio && <option value="both">Both separately</option>}
          </select>
        </label>
        {(["microphone", "system"] as const).filter(channel => channel === source || source === "both").map(channel =>
          <div key={channel} className="rounded-lg border border-white/10 p-3">
            <div className="flex justify-between gap-2"><span>{channel === "microphone" ? "Microphone" : "Call audio"}</span><span className={seen[channel] ? "text-emerald-300" : "text-amber-200"}>{seen[channel] ? "Activity detected" : "No activity confirmed"}</span></div>
            <meter aria-label={`${channel} level`} min={0} max={1} value={levels[channel]} className="my-2 w-full" />
            <p className="text-xs text-white/55">{states[channel]}</p>
          </div>)}
        <button className="rounded-lg bg-[#257c3c] px-4 py-2 font-semibold" onClick={() => void start()}>
          {phase === "starting" ? "Cancel permission request" : phase === "on" ? "Stop audio check" : "Start audio check"}
        </button>
        <p className="text-xs text-white/55">This device check processes levels locally without sending audio for transcription or saving it. It stops automatically after 45 seconds.</p>
        <div className="border-t border-white/10 pt-4">
          <button disabled={testing || answerBusy} className="rounded-lg border border-white/20 px-4 py-2 disabled:opacity-40" onClick={() => void testGemini()}>{testing ? "Testing Gemini…" : "Test Gemini answer"}</button>
          {testPassed && <p className="mt-2 text-emerald-300" role="status">Gemini answered successfully. Audio-to-answer still requires a confirmed remote source and Auto Answer.</p>}
          {testAnswer && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white/5 p-3">{testAnswer}</p>}
          <p className="mt-2 text-xs text-white/55">The fixed test question is sent to Gemini using this session’s existing settings. The test question and answer are not added to session history.</p>
        </div>
        {error && <p role="alert" className="text-amber-200">{error}</p>}
        <button onClick={onClose} className="rounded-lg border border-white/20 px-4 py-2">Close check · audio stops</button>
      </div>
    </DialogContent>
  </Dialog>;
}
