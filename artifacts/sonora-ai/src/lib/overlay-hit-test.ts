/** Visible desktop surfaces must receive the click. Only empty transparent gaps may pass through. */
const SURFACE = [
  ".dp-glass",
  ".dp-dialog",
  ".dp-backdrop",
  ".dp-menu-pop",
  ".dp-select",
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
  "[role='listbox']",
  "[role='option']",
].join(",");

export function overlayPointerCaptures(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest(SURFACE));
}

/** Typed chat wins. An empty box uses the line being heard, then the last heard line. */
export function liveAnswerQuestion(input: {
  typed?: string;
  latest?: string;
  interim?: string;
  spoken?: string;
}) {
  for (const value of [input.typed, input.interim, input.spoken, input.latest]) {
    const text = value?.trim() ?? "";
    if (/[\p{L}\p{N}]/u.test(text)) return text;
  }
  return "";
}
