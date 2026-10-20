import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export default function DesktopMaintenance() {
  const bridge = window.sonoraDesktop;
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Record<string, string | number | boolean>>({});
  const [update, setUpdate] = useState<Awaited<ReturnType<NonNullable<NonNullable<Window["sonoraDesktop"]>["checkForUpdates"]>>> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
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
    } catch (cause) { if (mine === sequence.current) setMessage(cause instanceof Error ? cause.message : "Maintenance unavailable."); }
    finally { if (mine === sequence.current) setBusy(false); }
  };
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await operation(); }
    catch { setUpdate(null); setMessage("Could not complete the request. A compatible release may not be published, or the service may be unavailable. Your installed version has not changed."); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="sonora-window-action mt-2" onClick={() => void show()}>About, diagnostics & updates</button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { ++sequence.current; setBusy(false); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-[#15171a] text-white sm:max-w-lg">
        <DialogTitle>Sonora desktop</DialogTitle>
        <DialogDescription className="text-white/60">Native app updates require a new installer. Hosted interface updates are separate.</DialogDescription>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-xs" aria-label="Diagnostic preview">{JSON.stringify(report, null, 2)}</pre>
        <p className="text-xs text-white/55">The exported native report contains only allowlisted version, platform and control-state fields. No audio, conversation content, credentials, account or device identifiers. Nothing is uploaded. The hosted check shown above is not included in the native export.</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="lsv-btn" disabled={busy || !bridge.exportDiagnostics} onClick={() => void run(async () => {
            const saved = await bridge.exportDiagnostics!();
            setMessage(saved ? "Privacy-safe report exported." : "Export cancelled.");
          })}>Export native diagnostics</button>
          <button className="lsv-btn" disabled={busy || !bridge.checkForUpdates} onClick={() => void run(async () => {
            setUpdate(null);
            const next = await bridge.checkForUpdates!(); setUpdate(next);
            setMessage(next.available ? `Sonora ${next.version} is available.` : "No newer compatible published version.");
          })}>Check for updates</button>
        </div>
        <a className="lsv-btn inline-flex" href={`${import.meta.env.BASE_URL}download`}>Browse approved-account downloads</a>
        {update?.available && <div className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
          <p>{update.signing}</p><p className="break-all text-xs text-white/55">SHA-256: {update.sha256}</p>
          <p>Download opens in your browser after confirmation. Installation is manual; Sonora does not restart automatically.</p>
          <p className="text-xs text-white/55">Before installing, compare the downloaded file’s SHA-256 with the hash above. Sonora does not automatically verify the downloaded bytes.</p>
          <button className="lsv-btn" disabled={busy || !bridge.openUpdate} onClick={() => void run(async () => { await bridge.openUpdate!(); })}>Download update…</button>
        </div>}
        {(message || busy) && <p role="status" className="text-sm text-amber-200">{busy ? "Checking…" : message}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
