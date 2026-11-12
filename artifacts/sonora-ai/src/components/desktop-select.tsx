import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

export type DesktopSelectOption = { value: string; label: string };

function nextMatch(options: DesktopSelectOption[], letter: string, from: number) {
  const key = letter.toLowerCase();
  if (key.length !== 1) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (from + step + options.length) % options.length;
    if (options[index]?.label.toLowerCase().startsWith(key)) return index;
  }
  return -1;
}

export function desktopShell() {
  return typeof window !== "undefined" && Boolean(window.sonoraDesktop);
}

export default function DesktopSelect({
  label,
  legend,
  value,
  options,
  onChange,
  disabled = false,
  scroll = false,
  id,
  className = "",
}: {
  label: string;
  legend?: string;
  value: string;
  options: DesktopSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  scroll?: boolean;
  id?: string;
  className?: string;
}) {
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = `${(id || label).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-list`;
  const current = options.find(option => option.value === value)?.label ?? (value || "Choose");

  const focusOption = (index: number) => {
    if (!options.length) return;
    const next = (index + options.length) % options.length;
    setActive(next);
    optionRefs.current[next]?.focus();
  };
  const openAt = (index: number) => {
    if (disabled || !options.length) return;
    setActive((index + options.length) % options.length);
    setOpen(true);
  };
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onPointer = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const typed = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "ArrowDown") openAt(open ? active + 1 : selectedIndex);
    else if (event.key === "ArrowUp") openAt(open ? active - 1 : selectedIndex);
    else if (event.key === "Home") openAt(0);
    else if (event.key === "End") openAt(options.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      if (!open) openAt(selectedIndex);
      else if (options[active]) choose(options[active].value);
    } else if (event.key === "Escape") {
      if (!open) return;
      event.stopPropagation();
      setOpen(false);
    } else if (typed) {
      const hit = nextMatch(options, event.key, open ? active : selectedIndex - 1);
      if (hit < 0) return;
      openAt(hit);
    } else return;
    event.preventDefault();
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown") focusOption(index + 1);
    else if (event.key === "ArrowUp") focusOption(index - 1);
    else if (event.key === "Home") focusOption(0);
    else if (event.key === "End") focusOption(options.length - 1);
    else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Enter" || event.key === " ") choose(options[index].value);
    else if (event.key === "Tab") { setOpen(false); return; }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const hit = nextMatch(options, event.key, index);
      if (hit < 0) return;
      focusOption(hit);
    } else return;
    event.preventDefault();
  };

  return (
    <div className={`dp-select ${className}`.trim()} ref={rootRef}>
      {legend && <span className="dp-select-legend">{legend}</span>}
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="dp-select-trigger"
        aria-label={`${label}, ${current}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => { if (open) setOpen(false); else openAt(selectedIndex); }}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{current}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div id={listId} role="listbox" aria-label={label} className={`dp-select-list${scroll ? " is-scroll" : ""}`}>
          {options.map((option, index) => (
            <button
              key={`${option.value}:${option.label}`}
              type="button"
              role="option"
              ref={element => { optionRefs.current[index] = element; }}
              className={`dp-select-option${index === active ? " is-active" : ""}`}
              aria-selected={option.value === value}
              tabIndex={index === active ? 0 : -1}
              onClick={() => choose(option.value)}
              onKeyDown={event => onOptionKeyDown(event, index)}
              onMouseEnter={() => setActive(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Desktop windows get the in-panel list. The website keeps its native select. */
export function ShellSelect({
  label, value, options, onChange, disabled, scroll, id, className,
}: {
  label: string;
  value: string;
  options: DesktopSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  scroll?: boolean;
  id?: string;
  className?: string;
}) {
  if (desktopShell()) return <DesktopSelect id={id} label={label} value={value} options={options} onChange={onChange} disabled={disabled} scroll={scroll} />;
  return (
    <select id={id} aria-label={label} className={className} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={`${option.value}:${option.label}`} value={option.value}>{option.label}</option>)}
    </select>
  );
}
