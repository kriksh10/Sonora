/** Server enforces 4s per source, even when a delayed queue drains quickly. */
export function createTranscriptionPacing(clock = Date.now) {
  const started: Partial<Record<"microphone" | "system", number>> = {};
  return {
    remaining(source: "microphone" | "system") {
      const last = started[source];
      return last === undefined ? 0 : Math.max(0, 4100 - (clock() - last));
    },
    mark(source: "microphone" | "system") { started[source] = clock(); },
  };
}

export function waitForTranscription(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}