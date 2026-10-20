import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EyeOff, GripHorizontal, Pin, Settings2, ShieldCheck, Square } from "lucide-react";
import DesktopMaintenance from "@/components/desktop-maintenance";
import { createBackgroundOpacity } from "@/lib/background-opacity";

type DesktopState = Awaited<ReturnType<NonNullable<Window["sonoraDesktop"]>["getState"]>>;

export default function DesktopVisibilityControls() {
  const bridge = window.sonoraDesktop;
  const bar = useRef<HTMLElement>(null);
  const [state, setState] = useState<DesktopState | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.85);
  const [opacityError, setOpacityError] = useState("");
  const opacityControl = useRef<ReturnType<typeof createBackgroundOpacity> | null>(null);

  useEffect(() => {
    if (!bridge) return;
    document.documentElement.classList.add("sonora-desktop");
    let mounted = true;
    const control = createBackgroundOpacity({
      save: async value => {
        if (!bridge.setBackgroundOpacity) throw new Error("Native opacity unavailable.");
        const next = await bridge.setBackgroundOpacity(value);
        if (mounted) setState(next);
        return next.backgroundOpacity ?? 0.85;
      },
      display: value => {
        setBackgroundOpacity(value);
        document.documentElement.style.setProperty("--sonora-background-opacity", String(value));
      },
      error: setOpacityError,
    });
    opacityControl.current = control;
    control.sync(0.85);
    let received = false;
    const off = bridge.onStateChange(next => {
      received = true;
      if (mounted) { setState(next); control.sync(next.backgroundOpacity ?? 0.85); }
    });
    void bridge.getState().then(next => {
      if (mounted && !received) { setState(next); control.sync(next.backgroundOpacity ?? 0.85); }
    }).catch(() => { if (mounted) setError("Desktop controls unavailable. Use the Sonora tray menu."); });
    return () => {
      mounted = false; off(); control.dispose(); opacityControl.current = null;
      document.documentElement.classList.remove("sonora-desktop");
      document.documentElement.style.removeProperty("--sonora-background-opacity");
      document.documentElement.style.removeProperty("--sonora-titlebar-height");
    };
  }, [bridge]);

  useLayoutEffect(() => {
    if (!bridge || !bar.current) return;
    const update = () => document.documentElement.style.setProperty("--sonora-titlebar-height", `${bar.current?.getBoundingClientRect().height ?? 44}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, [bridge]);

  if (!bridge) return null;
  // Older shells with opacity support reject anything below 45%.
  const minimumOpacity = state?.backgroundOpacityMin === 0.15 ? 15 : 45;
  const supported = state && ["win32", "darwin"].includes(state.platform);
  const run = async (action: () => Promise<DesktopState>) => {
    setPending(true); setError("");
    try { setState(await action()); }
    catch { setError("Setting not applied. Try again or use the tray menu."); }
    finally { setPending(false); }
  };

  return (
    <aside ref={bar} aria-label="Desktop window controls" className="sonora-window-bar">
      <span className="sonora-window-drag-handle desktop-drag inline-flex items-center gap-1 text-xs font-semibold text-white/80" title="Drag here to move Sonora">
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
          <div className="sonora-window-popover desktop-no-drag">
            <label className="block text-xs font-semibold">
              Background opacity · {Math.round(backgroundOpacity * 100)}%
              <input aria-label="Background opacity" aria-describedby="sonora-opacity-help" type="range" min={minimumOpacity} max="100" step="5"
                value={Math.round(backgroundOpacity * 100)} disabled={!state || typeof bridge.setBackgroundOpacity !== "function"}
                onChange={event => opacityControl.current?.set(Number(event.target.value) / 100)}
                className="mt-3 w-full accent-emerald-400" />
            </label>
            <p id="sonora-opacity-help" className="mt-2">{minimumOpacity}% is most transparent; 100% is opaque. Only the background changes, not the answer text. Settings stay opaque for readability.</p>
            {typeof bridge.setBackgroundOpacity === "function" && state && minimumOpacity === 45 &&
              <p className="mt-2 text-amber-200">This older shell supports 45–100%. Rebuild and install version 0.3.1 or newer for the 15% setting.</p>}
            {typeof bridge.setBackgroundOpacity === "function"
              ? <button disabled={!state} className="sonora-window-action mt-1" onClick={() => opacityControl.current?.set(1)}>Use opaque background</button>
              : <p role="status" className="mt-2 text-amber-200">Opacity is unavailable in this installed app. Rebuild and reinstall the latest Windows desktop kit; publishing the website alone cannot enable it.</p>}
            {opacityError && <p role="alert" className="mt-2 text-amber-200">{opacityError}</p>}
            <p className="mt-3">Drag the Sonora handle on the left to move. Resize from the edges. Pin keeps the window above other apps.</p>
            <p className="mt-2">Show again: tray → Show Sonora{state?.shortcutRegistered ? ` or ${bridge.shortcut}.` : ". Shortcut unavailable."}</p>
            <p className="mt-2">{state?.contentProtection ? "Capture exclusion requested" : "Capture exclusion off"} — not guaranteed. macOS ScreenCaptureKit and some sharing apps may still capture Sonora. Transparency does not mean hidden from sharing.</p>
            <p className="mt-2">Hiding does not stop audio. Use Stop audio here or in the tray.</p>
            {state?.preferencesError && <p className="mt-2 text-amber-200">{state.preferencesError}</p>}
             <DesktopMaintenance />
          </div>
        </details>
      </div>
      {error && <p role="alert" className="sonora-window-error">{error}</p>}
    </aside>
  );
}
