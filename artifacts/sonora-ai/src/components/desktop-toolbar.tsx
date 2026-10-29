import { useEffect, useState } from "react";
import { CircleStop, Command, EyeOff, Pin, ShieldAlert, ShieldCheck } from "lucide-react";

interface ToolbarState {
  alwaysOnTop: boolean;
  contentProtection: boolean;
  shortcutRegistered: boolean;
  platform: string;
  captureActive: boolean;
}

interface DesktopToolbarProps {
  captureActive: boolean;
  onStop: () => void;
}

function Toggle({ on, label, onClick, testId, children }: { on: boolean; label: string; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className={`flex min-h-[40px] flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${on ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-[#101113] text-white/65 hover:bg-white/5"}`}
    >
      <span className="flex items-center gap-2">{children}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${on ? "bg-emerald-400/20" : "bg-white/10"}`}>{on ? "On" : "Off"}</span>
    </button>
  );
}

export function DesktopToolbar({ captureActive, onStop }: DesktopToolbarProps) {
  const bridge = window.sonoraDesktop;
  const [state, setState] = useState<ToolbarState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.getState().then((s) => live && setState(s)).catch(() => live && setError("Could not read desktop state."));
    const off = bridge.onStateChange((s) => setState(s));
    return () => {
      live = false;
      off();
    };
  }, [bridge]);

  if (!bridge) return null;

  const run = async (fn: () => Promise<ToolbarState>) => {
    setError("");
    try {
      setState(await fn());
    } catch {
      setError("That change was not applied. Try again.");
    }
  };

  const protectedOn = !!state?.contentProtection;
  const active = state?.captureActive ?? captureActive;

  return (
    <section aria-label="Desktop controls" data-testid="panel-desktop-toolbar" className="mb-4 rounded-xl border border-white/10 bg-[#17181b] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle on={!!state?.alwaysOnTop} label="Keep on top" testId="toggle-always-on-top" onClick={() => void run(() => bridge.setAlwaysOnTop(!state?.alwaysOnTop))}>
          <Pin size={14} /> Pin on top
        </Toggle>
        <Toggle on={protectedOn} label="Hide from screen capture" testId="toggle-content-protection" onClick={() => void run(() => bridge.setContentProtection(!protectedOn))}>
          {protectedOn ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />} Capture exclusion
        </Toggle>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="button-desktop-hide" onClick={() => void run(() => bridge.hide())} className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-white/75 hover:bg-white/5">
          <EyeOff size={14} /> Hide window
        </button>
        {active && (
          <button type="button" data-testid="button-desktop-stop" onClick={onStop} className="inline-flex min-h-[36px] items-center gap-2 rounded-lg bg-red-500/15 px-3 text-xs font-semibold text-red-200 ring-1 ring-red-400/30 hover:bg-red-500/25">
            <CircleStop size={14} /> Stop capture
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-white/45" data-testid="text-desktop-shortcut">
          <Command size={12} /> {bridge.shortcut}
          {state && !state.shortcutRegistered && <span className="text-amber-300">(not registered)</span>}
        </span>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-white/45">
        Capture exclusion is best effort. The operating system or sharing app may still show this window; macOS ScreenCaptureKit can ignore it entirely. Do not rely on it.
        {active && " Hiding the window does not stop capture. Use Stop here or in the tray menu."}
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-red-200">{error}</p>}
    </section>
  );
}

export default DesktopToolbar;
