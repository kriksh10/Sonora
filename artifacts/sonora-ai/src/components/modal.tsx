import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href],button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';

export default function Modal({ label, onClose, children, width = "max-w-[760px]", busy = false, focusKey }: {
  label: string; onClose: () => void; children: ReactNode; width?: string; busy?: boolean; focusKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { previous?.focus?.(); };
  }, []);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ??
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => el.offsetParent !== null && !el.hasAttribute("data-skip-focus"));
    (first ?? root).focus();
  }, [focusKey]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.stopPropagation(); if (!busy) closeRef.current(); return; }
    if (event.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" tabIndex={-1} style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} aria-modal="true" aria-label={label} onKeyDown={onKeyDown}
        className={`my-auto max-h-[94dvh] w-full ${width} overflow-y-auto rounded-2xl border border-white/10 bg-[#111214] p-5 text-[#e7e8eb] shadow-2xl sm:p-7`}>
        {children}
      </div>
    </div>
  );
}
