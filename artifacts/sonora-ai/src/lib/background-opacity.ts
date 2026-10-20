/** Optimistic preview with one native write at a time and latest-intent coalescing. */
export function createBackgroundOpacity(options: {
  save: (value: number) => Promise<number>;
  display: (value: number) => void;
  error: (message: string) => void;
  timeoutMs?: number;
}) {
  let confirmed = 0.85;
  let wanted = confirmed;
  let revision = 0;
  let saving = false;
  let disposed = false;
  const valid = (value: number) => Number.isFinite(value) && value >= 0.15 && value <= 1;

  async function flush() {
    saving = true;
    while (!disposed) {
      const sentRevision = revision;
      const value = wanted;
      try {
        const result = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Native opacity timed out.")), options.timeoutMs ?? 5000);
          Promise.resolve().then(() => options.save(value)).then(
            result => { clearTimeout(timer); resolve(result); },
            error => { clearTimeout(timer); reject(error); },
          );
        });
        if (disposed) return;
        if (!valid(result)) throw new Error("Invalid native opacity response.");
        confirmed = result;
        if (sentRevision === revision) options.display(result);
      } catch {
        if (disposed) return;
        if (sentRevision === revision) {
          wanted = confirmed;
          options.display(confirmed);
          options.error("Opacity was not applied. Try again. If this keeps happening, rebuild and reinstall the latest desktop app.");
        }
      }
      if (sentRevision === revision) break;
    }
    saving = false;
  }

  return {
    set(value: number) {
      if (disposed || !valid(value)) return;
      wanted = value;
      revision++;
      options.error("");
      options.display(value);
      if (!saving) void flush();
    },
    sync(value: number) {
      // Native broadcasts for earlier writes must not move the thumb back.
      if (disposed || saving || !valid(value)) return;
      confirmed = wanted = value;
      options.display(value);
    },
    dispose() { disposed = true; },
  };
}
