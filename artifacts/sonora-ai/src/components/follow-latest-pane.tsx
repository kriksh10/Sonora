import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";

type Props = {
  /** Changing this (e.g. session id) re-pins the pane to the latest content. */
  resetKey: string;
  label: string;
  children: ReactNode;
  testId?: string;
  jumpTestId?: string;
  jumpLabel?: string;
  className?: string;
  /** Pixels from bottom still considered "at latest". */
  threshold?: number;
  /** Answer panes stay where the reader left them. Transcript panes follow. */
  follow?: boolean;
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function FollowLatestPane({
  resetKey,
  label,
  children,
  testId,
  jumpTestId = "jump-to-latest",
  jumpLabel = "Jump to latest",
  className = "",
  threshold = 32,
  follow = true,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastTopRef = useRef(0);
  const [pinned, setPinned] = useState(true);
  const [overflow, setOverflow] = useState(false);

  const setPin = useCallback((value: boolean) => {
    pinnedRef.current = value;
    setPinned(value);
  }, []);

  const toBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollHeight - el.clientHeight;
    if (smooth && !prefersReducedMotion() && typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: "smooth" });
    } else {
      el.scrollTop = top;
    }
    lastTopRef.current = top;
  }, []);

  useLayoutEffect(() => {
    setPin(true);
    if (follow) toBottom(false);
  }, [resetKey, setPin, toBottom, follow]);

  useLayoutEffect(() => {
    if (follow && pinnedRef.current) toBottom(false);
    const el = scrollRef.current;
    if (el) setOverflow(el.scrollHeight > el.clientHeight + 2);
  }, [children, toBottom, follow]);

  useEffect(() => {
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setOverflow(el.scrollHeight > el.clientHeight + 2);
      if (follow && pinnedRef.current) toBottom(false);
    });
    ro.observe(content);
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom, follow]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    const movedUp = el.scrollTop < lastTopRef.current - 1;
    lastTopRef.current = el.scrollTop;
    if (distance <= threshold) {
      if (!pinnedRef.current) setPin(true);
    } else if (movedUp && pinnedRef.current) {
      setPin(false);
    }
  };

  return (
    <div className={`lsv-follow ${className}`}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label={label}
        aria-live={pinned ? "polite" : "off"}
        aria-relevant="additions text"
        tabIndex={0}
        data-testid={testId}
        data-following={pinned ? "true" : "false"}
        className="lsv-scroll"
      >
        <div ref={contentRef} className="lsv-scroll-content">
          {children}
        </div>
        {!follow && overflow && (
          <div className="lsv-chevrons">
            <button type="button" aria-label="Scroll answer up" onClick={() => scrollRef.current?.scrollBy({ top: -200 })}>↑</button>
            <button type="button" aria-label="Scroll answer down" onClick={() => scrollRef.current?.scrollBy({ top: 200 })}>↓</button>
          </div>
        )}
      </div>
      {!pinned && (
        <button
          type="button"
          data-testid={jumpTestId}
          className="lsv-jump"
          onClick={() => {
            setPin(true);
            toBottom(false);
          }}
        >
          <ArrowDown size={14} aria-hidden="true" /> {jumpLabel}
        </button>
      )}
    </div>
  );
}
