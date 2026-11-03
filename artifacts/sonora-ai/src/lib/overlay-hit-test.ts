/** Visible desktop surfaces must receive the click. Only empty transparent gaps may pass through. */
const SURFACE = [
  ".dp-glass",
  ".dp-dialog",
  ".dp-backdrop",
  ".dp-menu-pop",
  ".dp-chat",
  ".sonora-window-bar",
  ".sonora-window-popover",
  ".sonora-window-error",
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "summary",
  "label",
  "[role='button']",
].join(",");

export function overlayPointerCaptures(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest(SURFACE));
}

/** Prefer the spoken line the candidate can see, then whatever they typed. */
export function liveAnswerQuestion(input: {
  typed?: string;
  latest?: string;
  interim?: string;
  spoken?: string;
}) {
  for (const value of [input.typed, input.latest, input.interim, input.spoken]) {
    const text = value?.trim() ?? "";
    if (/[\p{L}\p{N}]/u.test(text)) return text;
  }
  return "";
}
