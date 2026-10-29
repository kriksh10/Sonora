import type { CaptureDiagnostic } from "@/lib/continuous-audio";

export default function CaptureDiagnostics({ events }: { events: CaptureDiagnostic[] }) {
  if (!events.length) return null;
  const losses = events.filter(e => e.event === "dropped" || e.event === "skipped").length;
  return <details className="rounded-lg border border-white/10 p-3 text-xs" data-testid="capture-diagnostics">
    <summary className="cursor-pointer">Capture diagnostics · Gemini · {losses} dropped/skipped events in recent log</summary>
    <p className="py-2 text-zinc-400">Latest 120 events for this interview round. Metadata only; no audio or recognized words are stored here. Capture continues while transcription is queued. Sustained provider failures or Stop can discard clips; each is logged.</p>
    <ol className="max-h-52 overflow-auto space-y-1" aria-label="Capture event log">
      {events.map((e, i) => <li key={`${e.at}-${i}`}>
        <time>{new Date(e.at).toLocaleTimeString()}</time> · {e.source} · {e.event}
        {e.clip ? ` · clip ${e.clip}` : ""}{e.durationMs ? ` · ${e.durationMs}ms` : ""} · {e.detail}
      </li>)}
    </ol>
  </details>;
}
