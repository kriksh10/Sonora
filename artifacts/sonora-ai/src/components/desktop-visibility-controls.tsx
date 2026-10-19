import { useEffect, useState } from 'react';
import { EyeOff, ShieldCheck } from 'lucide-react';

type DesktopState = Awaited<ReturnType<NonNullable<Window['sonoraDesktop']>['getState']>>;

export default function DesktopVisibilityControls() {
  const bridge = window.sonoraDesktop;
  const [state, setState] = useState<DesktopState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    let receivedEvent = false;
    const off = bridge.onStateChange(next => {
      receivedEvent = true;
      if (mounted) setState(next);
    });
    void bridge.getState().then(next => {
      if (mounted && !receivedEvent) setState(next);
    }).catch(() => {
      if (mounted) setError('Desktop controls could not connect. Use the Sonora tray menu.');
    });
    return () => { mounted = false; off(); };
  }, [bridge]);

  if (!bridge) return null;
  const supported = state && ['win32', 'darwin'].includes(state.platform);
  const run = async (action: () => Promise<DesktopState>) => {
    setPending(true);
    setError('');
    try { setState(await action()); }
    catch { setError('The desktop setting could not be changed. Use the Sonora tray menu.'); }
    finally { setPending(false); }
  };

  return (
    <aside aria-label="Desktop visibility controls" className="sticky top-0 z-50 border-b border-white/15 bg-[#17181b] px-4 py-3 text-xs text-white shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={!state || pending} onClick={() => void run(() => bridge.hide())}
          className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 hover:bg-white/10 disabled:opacity-50">
          <EyeOff size={15} /> Hide Sonora
        </button>
        <label className="flex cursor-pointer items-center gap-2">
          <ShieldCheck size={15} className="text-emerald-300" />
          <input type="checkbox" role="switch" checked={state?.contentProtection ?? false}
            disabled={!supported || pending} onChange={event => {
              const requested = event.target.checked;
              void run(() => bridge.setContentProtection(requested));
            }} className="h-4 w-4 accent-emerald-500" />
          Hide from screen sharing
        </label>
      </div>
      <p className="mt-2 leading-5 text-white/65">
        Show again: Sonora tray menu → Show Sonora{state?.shortcutRegistered ? `, or ${bridge.shortcut}` : '.'}
        {state && !state.shortcutRegistered && <span className="text-amber-200"> Keyboard shortcut unavailable; use the tray.</span>}
      </p>
      <p className="leading-5 text-white/55">
        {!state ? 'Connecting to desktop controls…' : !supported ? 'Screen-sharing exclusion is not supported on this platform.'
          : state.contentProtection ? 'Capture exclusion requested; Sonora stays visible to you. Not guaranteed in every sharing app.'
          : 'Capture exclusion is off; Sonora may appear in screen shares.'}
        {state?.platform === 'darwin' && ' macOS ScreenCaptureKit sharing may still capture this window.'}
        {state?.captureActive && ' Audio capture is active and continues while hidden. Use tray → Stop audio capture to stop.'}
      </p>
      {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
    </aside>
  );
}
