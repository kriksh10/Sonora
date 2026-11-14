import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EyeOff, GripHorizontal, Minus, Pin, Settings2, ShieldCheck, Square } from "lucide-react";
import DesktopMaintenance from "@/components/desktop-maintenance";
import DesktopHotkeysSheet from "@/components/desktop-hotkeys-sheet";
import { createBackgroundOpacity } from "@/lib/background-opacity";

type DesktopState = Awaited<ReturnType<NonNullable<Window["sonoraDesktop"]>["getState"]>>;

export default function DesktopVisibilityControls() {
  const bridge = window.sonoraDesktop;
  const bar = useRef<HTMLElement>(null);
  const [state, setState] = useState<DesktopState | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.45);
  const [opacityError, setOpacityError] = useState("");
  const [shortcutError, setShortcutError] = useState("");
  const opacityControl = useRef<ReturnType<typeof createBackgroundOpacity> | null>(null);
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, originX: 0, originY: 0 });
  const applyShell = (next: DesktopState | null | undefined) => {
    if (!next) return;
    document.documentElement.classList.toggle("sonora-collapsed", !!next.collapsed);
  };

  useEffect(() => {
    if (!bridge) return;
    document.documentElement.classList.add("sonora-desktop");
    let mounted = true;
    const control = createBackgroundOpacity({
      save: async value => {
        if (!bridge.setBackgroundOpacity) throw new Error("Native opacity unavailable.");
        const next = await bridge.setBackgroundOpacity(value);
        if (mounted) setState(next);
        return next.backgroundOpacity ?? 0.45;
      },
      display: value => {
        setBackgroundOpacity(value);
        document.documentElement.style.setProperty("--sonora-background-opacity", String(value));
      },
      error: setOpacityError,
    });
    opacityControl.current = control;
    control.sync(0.45);
    let received = false;
    const off = bridge.onStateChange(next => {
      received = true;
      if (mounted) {
        setState(next);
        control.sync(next.backgroundOpacity ?? 0.45);
        applyShell(next);
        document.documentElement.style.setProperty("--sonora-font-scale", String(next.fontScale ?? 1));
      }
    });
    void bridge.getState().then(next => {
      if (mounted && !received) {
        setState(next);
        control.sync(next.backgroundOpacity ?? 0.45);
        applyShell(next);
        document.documentElement.style.setProperty("--sonora-font-scale", String(next.fontScale ?? 1));
      }
    }).catch(() => { if (mounted) setError("Desktop controls unavailable. Use the Sonora tray menu."); });
    return () => {
      mounted = false; off(); control.dispose(); opacityControl.current = null;
      document.documentElement.classList.remove("sonora-desktop", "sonora-collapsed");
      document.documentElement.style.removeProperty("--sonora-background-opacity");
      document.documentElement.style.removeProperty("--sonora-titlebar-height");
      document.documentElement.style.removeProperty("--sonora-font-scale");
    };
  }, [bridge]);

  useLayoutEffect(() => {
    if (state?.collapsed) document.documentElement.classList.add("sonora-collapsed");
  }, [state]);

  const dragDistance = (event: ReactPointerEvent<HTMLElement>) => {
    const scale = window.devicePixelRatio || 1;
    return Math.hypot(event.screenX - drag.current.originX, event.screenY - drag.current.originY) / scale;
  };
  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current.active) return;
    if (dragDistance(event) >= 4) drag.current.moved = true;
    void bridge?.dragCollapsed?.("move");
  };
  const pointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current.active) return;
    if (dragDistance(event) >= 4) drag.current.moved = true;
    drag.current.active = false;
    void bridge?.dragCollapsed?.("end");
  };

  useLayoutEffect(() => {
    if (!bridge || !bar.current) return;
    const update = () => document.documentElement.style.setProperty("--sonora-titlebar-height", `${bar.current?.getBoundingClientRect().height ?? 44}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, [bridge]);

  if (!bridge) return null;
  // 15% is near-clear. A shell that publishes a higher floor keeps that floor.
  const minimumOpacity = typeof state?.backgroundOpacityMin === "number" ? Math.round(state.backgroundOpacityMin * 100) : 15;
  const supported = state && ["win32", "darwin"].includes(state.platform);
  const run = async (action: () => Promise<DesktopState>) => {
    setPending(true); setError("");
    try {
      const next = await action();
      setState(next);
      applyShell(next);
    }
    catch { setError("Setting not applied. Try again or use the tray menu."); }
    finally { setPending(false); }
  };

  return (
    <aside ref={bar} aria-label="Desktop window controls" className="sonora-window-bar sonora-overlay-controls">
      <button type="button" className="sonora-dock" aria-label="Sonora listening" title="Sonora listening. Drag to move. Click to restore."
        onPointerDown={event => {
          if (!state?.collapsed || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { active: true, moved: false, x: event.screenX, y: event.screenY, originX: event.screenX, originY: event.screenY };
          void bridge.dragCollapsed?.("start");
        }}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onClick={() => {
          if (drag.current.moved) { drag.current.moved = false; return; }
          void run(() => bridge.minimize!());
        }}>
        <svg className="sonora-dock-mark" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <rect width="64" height="64" rx="16" fill="#75c853" />
          <path d="M32 12v40M18 20l28 24M46 20 18 44" fill="none" stroke="#19321d" strokeLinecap="round" strokeWidth="6" />
        </svg>
        <span className="sonora-dock-live" aria-hidden="true" />
      </button>
      <span className="sonora-window-drag-handle desktop-drag inline-flex items-center gap-1 text-xs font-semibold text-white/80" title="Drag here to move Sonora"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          void bridge.dragWindow?.("start");
        }}
        onPointerMove={() => { void bridge.dragWindow?.("move"); }}
        onPointerUp={() => { void bridge.dragWindow?.("end"); }}>
        <GripHorizontal size={17} /> Sonora
      </span>
      <div className="desktop-no-drag ml-auto flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" }}>
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
        <button type="button" disabled={pending || !bridge.minimize} className="sonora-window-action" aria-label="Minimize" style={{ WebkitAppRegion: "no-drag", backgroundColor: "rgba(128, 128, 128, 0.01)" }}
          title="Collapse to a listening icon. Ctrl+H does the same during a live session."
          onClick={() => void run(() => bridge.minimize!())}><Minus size={14} /></button>
        <button type="button" disabled={!state || pending} className="sonora-window-action" aria-label="Hide Sonora"
          title="Close the window. The tray icon appears until you open Sonora again. Audio keeps running."
          onClick={() => void run(() => bridge.hide())}><EyeOff size={14} /></button>
        <label className="sonora-opacity-inline" title={`Overlay opacity ${Math.round(backgroundOpacity * 100)}%`}>
          <input aria-label="Overlay opacity" type="range" min={minimumOpacity} max="95" step="10"
            value={Math.round(backgroundOpacity * 100)} disabled={!state || typeof bridge.setBackgroundOpacity !== "function"}
            onChange={event => opacityControl.current?.set(Number(event.target.value) / 100)}
            className="sonora-slim-slider" />
        </label>
        <details className="sonora-window-settings">
          <summary className="sonora-window-action cursor-pointer list-none" aria-label="Window settings"><Settings2 size={15} /></summary>
          <div className="sonora-window-popover desktop-no-drag">
            <label className="block text-xs font-semibold">
              Background opacity · {Math.round(backgroundOpacity * 100)}%
              <input aria-label="Background opacity" aria-describedby="sonora-opacity-help" type="range" min={minimumOpacity} max="95" step="10"
                value={Math.round(backgroundOpacity * 100)} disabled={!state || typeof bridge.setBackgroundOpacity !== "function"}
                onChange={event => opacityControl.current?.set(Number(event.target.value) / 100)}
                className="sonora-slim-slider mt-3 w-full" />
            </label>
            <p id="sonora-opacity-help" className="mt-2">The slider runs from {minimumOpacity}% to 95% in steps of 10. Only the card and panel fill change. Text stays solid. The window bar sits 10 points lower than the cards. A 4% hit plate keeps clicks on Sonora.</p>
            {typeof bridge.setBackgroundOpacity !== "function" &&
              <p role="status" className="mt-2 text-amber-200">Opacity is unavailable in this installed app. Rebuild and reinstall the latest Windows desktop kit; publishing the website alone cannot enable it.</p>}
            {opacityError && <p role="alert" className="mt-2 text-amber-200">{opacityError}</p>}
            <p className="mt-3">Drag the Sonora handle on the left to move. Resize from the edges. Pin keeps the window above other apps.</p>
            <p className="mt-2">Collapse shrinks this window to a listening icon. Hide closes it and shows the tray. Open the tray, or click the icon, to come back. Ctrl+H collapses and restores during a live session.</p>
            <p className="mt-2">{state?.contentProtection ? "Capture exclusion requested" : "Capture exclusion off"} — not guaranteed. macOS ScreenCaptureKit and some sharing apps may still capture Sonora. Transparency does not mean hidden from sharing.</p>
            <p className="mt-2">Hiding does not stop audio. Use Stop audio here or in the tray.</p>
            <label className="mt-3 block text-xs font-semibold">
              Text size · {Math.round((state?.fontScale ?? 1) * 100)}%
              <input aria-label="Overlay text size" type="range" min="85" max="160" step="5"
                value={Math.round((state?.fontScale ?? 1) * 100)} disabled={!state || !bridge.setFontScale}
                onChange={event => void run(() => bridge.setFontScale!(Number(event.target.value) / 100))}
                className="sonora-slim-slider mt-2 w-full" />
            </label>
            <label className="mt-3 flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" aria-label="Click through the overlay" checked={!!state?.clickThrough} disabled={!state || !bridge.setClickThrough}
                onChange={event => void run(() => bridge.setClickThrough!(event.target.checked))} />
              Click through the overlay
            </label>
            <p className="mt-1">Click through sends clicks to the app behind Sonora until you turn it off. The eye hides this window. The shield only asks other apps not to capture it.</p>
            <label className="mt-3 flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" aria-label="Show transcript panel" checked={!!state?.transcriptOpen} disabled={!state || !bridge.setTranscriptOpen}
                onChange={event => void run(() => bridge.setTranscriptOpen!(event.target.checked))} />
              Show transcript panel
            </label>
            <label className="mt-3 flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" aria-label="Start Sonora when I sign in" checked={!!state?.openAtLogin} disabled={!state || !bridge.setOpenAtLogin}
                onChange={event => void run(() => bridge.setOpenAtLogin!(event.target.checked))} />
              Start Sonora when I sign in
            </label>
            <p className="mt-1">Off until you turn it on. It applies to the installed app.</p>
            {bridge.setHotkeys && bridge.resetHotkeys && <DesktopHotkeysSheet
              hotkeys={state?.hotkeys ?? []} error={shortcutError}
              onChange={async (id, accelerator) => {
                setShortcutError("");
                try { setState(await bridge.setHotkeys!({ [id]: accelerator })); }
                catch (cause) { setShortcutError(cause instanceof Error ? cause.message : "That shortcut was not saved."); }
              }}
              onReset={async () => {
                setShortcutError("");
                try { setState(await bridge.resetHotkeys!()); }
                catch { setShortcutError("Could not reset shortcuts."); }
              }} />}
            {state?.preferencesError && <p className="mt-2 text-amber-200">{state.preferencesError}</p>}
             <DesktopMaintenance />
          </div>
        </details>
      </div>
      {error && <p role="alert" className="sonora-window-error">{error}</p>}
    </aside>
  );
}
