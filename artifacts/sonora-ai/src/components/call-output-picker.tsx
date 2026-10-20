import { useEffect, useState } from "react";

/** Endpoint names stay on this PC, never in session history or diagnostics. */
export default function CallOutputPicker({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const [devices, setDevices] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const supported = window.sonoraDesktop?.platform === "win32" && !!window.sonoraDesktop.listAudioDevices;
  useEffect(() => {
    if (!supported || disabled) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    window.sonoraDesktop!.listAudioDevices!("system").then(result => {
      if (!cancelled) setDevices(result);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not list output devices.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supported, disabled, revision]);
  if (!window.sonoraDesktop) return null;
  return (
    <div className="lsv-banner" data-testid="call-output-picker">
      {supported && <label>
        Meeting output{" "}
        <select className="lsv-select" aria-label="Meeting output device" value={value} disabled={disabled || loading || !!error}
          onChange={event => onChange(event.target.value)}>
          <option value="">Windows default output</option>
          {value && !devices.includes(value) && <option value={value}>{value} (unavailable — refresh or select another)</option>}
          {devices.map(name => <option key={name} value={name}>{name}</option>)}
        </select>{" "}
      </label>}
      {supported && <button type="button" className="lsv-btn" disabled={disabled || loading} onClick={() => setRevision(v => v + 1)}>
        {loading ? "Loading devices…" : "Refresh devices"}
      </button>}
      <div>
        {supported
          ? "Choose the same speaker/headset as Google Meet → Settings → Audio → Speakers. Stop audio before switching devices."
          : window.sonoraDesktop.platform === "win32"
            ? "This desktop build captures Windows default output only. Match Meet’s speaker to Windows default, or rebuild/install the updated app for output selection."
            : "Call audio captures supported computer output. Confirm the Call activity meter moves when the interviewer speaks."}
      </div>
      {error && <div role="alert">{error}</div>}
    </div>
  );
}
