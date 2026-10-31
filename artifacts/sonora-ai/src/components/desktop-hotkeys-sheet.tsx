import { useState } from "react";

type Hotkey = { id: string; label: string; accelerator: string; registered: boolean };

export default function DesktopHotkeysSheet({
  hotkeys, error, onChange, onReset,
}: {
  hotkeys: Hotkey[];
  error: string;
  onChange: (id: string, accelerator: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const shown = (item: Hotkey) => drafts[item.id] ?? item.accelerator;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Keyboard shortcuts</p>
        <button type="button" className="sonora-window-action" onClick={() => void onReset()}>Reset</button>
      </div>
      <ul className="mt-2 space-y-1">
        {hotkeys.map(item => (
          <li key={item.id} className="grid grid-cols-[1fr_1.1fr] items-center gap-2">
            <span>{item.label}{item.accelerator && !item.registered ? <span className="text-amber-200"> · not registered</span> : null}</span>
            <input aria-label={`${item.label} shortcut`} value={shown(item)} spellCheck={false}
              className="rounded border border-white/15 bg-[#101113] px-1.5 py-1 font-mono text-[10px]"
              onChange={event => setDrafts(current => ({ ...current, [item.id]: event.target.value }))}
              onBlur={() => {
                const next = shown(item);
                if (next === item.accelerator) return;
                void onChange(item.id, next).then(() => setDrafts(current => {
                  const copy = { ...current };
                  delete copy[item.id];
                  return copy;
                }));
              }} />
          </li>
        ))}
      </ul>
      <p className="mt-2">Use Electron names such as <span className="font-mono">Ctrl+Shift+Enter</span>. Leave a field empty to disable that shortcut. Move uses Ctrl+Shift+arrows. Toggle stays on Ctrl+Shift+Space.</p>
      {error && <p role="alert" className="mt-2 text-amber-200">{error}</p>}
    </div>
  );
}
