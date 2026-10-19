import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EyeOff, GripHorizontal, Pin, Settings2, ShieldCheck, Square } from "lucide-react";

type DesktopState = Awaited<ReturnType<NonNullable<Window["sonoraDesktop"]>["getState"]>>;

export default function DesktopVisibilityControls() {
  const bridge = window.sonoraDesktop;
  const bar = useRef<HTMLElement>(null);
  const [state, setState] = useState<DesktopState | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    document.documentElement.classList.add("sonora-desktop");
    let mounted = true;
    let received = false;
    const off = bridge.onStateChange(next => { received = true; if (mounted) setState(next); });
    void bridge.getState().then(next => {
      if (mounted && !received) setState(next);
    }).catch(() => { if (mounted) setError("Desktop controls unavailable. Use the Sonora tray menu."); });
    return () => {
      mounted = false; off();
      document.documentElement.classList.remove("sonora-desktop");
      document.documentElement.style.removeProperty("--sonora-background-opacity");
      document.documentElement.style.removeProperty("--sonora-titlebar-height");
    };
  }, [bridge]);

  useEffect(() => {
    if (bridge) document.documentElement.style.setProperty("--sonora-background-opacity", String(state?.backgroundOpacity ?? 0.85));
  }, [bridge, state?.backgroundOpacity]);

  useLayoutEffect(() => {
    if (!bridge || !bar.current) return;
    const update = () => document.documentElement.style.setProperty("--sonora-titlebar-height", `${bar.current?.getBoundingClientRect().height ?? 44}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, [bridge]);

  if (!bridge) return null;
  const supported = state && ["win32", "darwin"].includes(state.platform);
  const run = async (action: () => Promise<DesktopState>) => {
    setPending(true); setError("");
    try { setState(await action()); }
    catch { setError("Setting not applied. Try again or use the tray menu."); }
    finally { setPending(false); }
  };

  return (
    <aside ref={bar} aria-label="Desktop window controls" className="sonora-window-bar desktop-drag">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-white/80" title="Drag this bar to move Sonora">
        <GripHorizontal size={17} /> Sonora
      </span>
      <div className="desktop-no-drag ml-auto flex items-center gap-1">
        {state?.captureActive && <button type="button" className="sonora-window-action text-red-200" aria-label="Stop all audio"
          onClick={() => { if (bridge.stopAllCapture) void bridge.stopAllCapture().catch(() => setError("Use tray → Stop audio capture.")); else window.dispatchEvent(new Event("sonora-stop-audio")); }}>
          <Square size={13} /> Stop audio
        </button>}
        <button type="button" disabled={!state || pending} aria-pressed={state?.alwaysOnTop ?? false} aria-label="Keep on top"
          className={`sonora-window-action ${state?.alwaysOnTop ? "text-emerald-300" : ""}`}
          onClick={() => void run(() => bridge.setAlwaysOnTop(!state?.alwaysOnTop))}><Pin size={14} /></button>
        <button type="button" disabled={!supported || pending} aria-pressed={state?.contentProtection ?? false}
          aria-label="Hide from screen sharing (best effort)" title="Screen-share exclusion is best effort"
          className={`sonora-window-action ${state?.contentProtection ? "text-emerald-300" : ""}`}
          onClick={() => void run(() => bridge.setContentProtection(!state?.contentProtection))}><ShieldCheck size={14} /></button>
        <button type="button" disabled={!state || pending} className="sonora-window-action" aria-label="Hide Sonora"
          onClick={() => void run(() => bridge.hide())}><EyeOff size={14} /></button>
        <details className="sonora-window-settings">
          <summary className="sonora-window-action cursor-pointer list-none" aria-label="Window settings"><Settings2 size={15} /></summary>
          <div className="sonora-window-popover">
            <label className="block text-xs font-semibold">
              Background opacity · {Math.round((state?.backgroundOpacity ?? 1) * 100)}%
              <input aria-label="Background opacity" type="range" min="45" max="100" step="5"
                value={Math.round((state?.backgroundOpacity ?? 1) * 100)} disabled={!bridge.setBackgroundOpacity}
                onChange={event => { const value = Number(event.target.value) / 100; void run(() => bridge.setBackgroundOpacity!(value)); }}
                className="mt-3 w-full accent-emerald-400" />
            </label>
            {bridge.setBackgroundOpacity
              ? <button className="sonora-window-action mt-1" onClick={() => void run(() => bridge.setBackgroundOpacity!(1))}>Use opaque background</button>
              : <p className="mt-2 text-amber-200">Install the rebuilt app for native transparency and separate audio channels.</p>}
            <p className="mt-3">Drag the top bar to move. Resize from the edges. Pin keeps the window above other apps.</p>
            <p className="mt-2">Show again: tray → Show Sonora{state?.shortcutRegistered ? ` or ${bridge.shortcut}.` : ". Shortcut unavailable."}</p>
            <p className="mt-2">{state?.contentProtection ? "Capture exclusion requested" : "Capture exclusion off"} — not guaranteed. macOS ScreenCaptureKit and some sharing apps may still capture Sonora. Transparency does not mean hidden from sharing.</p>
            <p className="mt-2">Hiding does not stop audio. Use Stop audio here or in the tray.</p>
            {state?.preferencesError && <p className="mt-2 text-amber-200">{state.preferencesError}</p>}
          </div>
        </details>
      </div>
      {error && <p role="alert" className="sonora-window-error">{error}</p>}
    </aside>
  );
}
