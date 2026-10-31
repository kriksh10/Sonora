import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type UpdateStatus = { phase: string; version: string | null; percent: number | null; message: string };

export default function DesktopMaintenance() {
  const bridge = window.sonoraDesktop;
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Record<string, string | number | boolean>>({});
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    if (!bridge?.onUpdate) return;
    return bridge.onUpdate(status => setUpdate(status));
  }, [bridge]);
  if (!bridge) return null;
  const show = async () => {
    setOpen(true); setMessage(""); setBusy(true);
    const mine = ++sequence.current;
    try {
      const native = await bridge.getDiagnostics?.();
      if (!native) throw new Error("Rebuild and reinstall Sonora to use maintenance tools.");
      let compatibility = "Hosted service unavailable";
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/healthz`, { signal: AbortSignal.timeout(8000), credentials: "include" });
        const health = await response.json();
        compatibility = response.ok && health.status === "ok"
          ? `Hosted auth ${health.desktopAuthProtocol ?? "unknown"} · audio ${health.desktopAudioProtocol ?? "unknown"} · answers ${health.desktopAnswerProtocol ?? "legacy"}`
          : "Hosted service unavailable or sign-in required";
      } catch { /* Show unavailable explicitly; do not export network errors or URLs. */ }
      if (mine === sequence.current) setReport({ ...native, hostedCompatibility: compatibility });
      if (bridge.updateStatus && mine === sequence.current) setUpdate(await bridge.updateStatus());
    } catch (cause) { if (mine === sequence.current) setMessage(cause instanceof Error ? cause.message : "Maintenance unavailable."); }
    finally { if (mine === sequence.current) setBusy(false); }
  };
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await operation(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not complete the request. Your installed version has not changed."); }
    finally { setBusy(false); }
  };
  const phase = update?.phase;
  return <>
    <button type="button" className="sonora-window-action mt-2" onClick={() => void show()}>About, diagnostics & updates</button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { ++sequence.current; setBusy(false); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-[#15171a] text-white sm:max-w-lg">
        <DialogTitle>Sonora desktop</DialogTitle>
        <DialogDescription className="text-white/60">Installed updates download in the background and install when you restart or quit. The hosted interface updates separately.</DialogDescription>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-xs" aria-label="Diagnostic preview">{JSON.stringify(report, null, 2)}</pre>
        <p className="text-xs text-white/55">The exported native report contains only allowlisted version, platform and control-state fields. No audio, conversation content, credentials, account or device identifiers. Nothing is uploaded. The hosted check shown above is not included in the native export.</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="lsv-btn" disabled={busy || !bridge.exportDiagnostics} onClick={() => void run(async () => {
            const saved = await bridge.exportDiagnostics!();
            setMessage(saved ? "Privacy-safe report exported." : "Export cancelled.");
          })}>Export native diagnostics</button>
          <button className="lsv-btn" disabled={busy || !bridge.checkForUpdates} onClick={() => void run(async () => {
            const next = await bridge.checkForUpdates!();
            if (next && "phase" in next) setUpdate(next);
            setMessage(next?.message || (next?.phase === "current" ? "Sonora is up to date." : "Update check finished."));
          })}>Check for updates</button>
          {phase === "ready" && bridge.installUpdate && <button className="lsv-btn" disabled={busy} onClick={() => void run(async () => { await bridge.installUpdate!(); })}>Restart and install</button>}
        </div>
        {update && <p className="text-sm text-white/80" role="status">{update.message}{phase === "downloading" && update.percent != null ? ` ${update.percent}%` : ""}</p>}
        {(message || busy) && <p role="status" className="text-sm text-amber-200">{busy ? "Working…" : message}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
