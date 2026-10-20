import { Worker } from "node:worker_threads";

export function extractWord(bytes: Buffer, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./word-worker.cjs", import.meta.url), {
      workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    });
    let settled = false;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error); else resolve(text!);
    };
    const abort = () => finish(new Error("Document reading cancelled."));
    const timeout = setTimeout(() => finish(new Error("Document reading timed out. Paste the text or simplify the document.")), 8000);
    worker.once("message", result => finish(result.error ? new Error(result.error) : undefined, result.text));
    worker.once("error", () => finish(new Error("Document exceeded safe processing limits or could not be read.")));
    worker.once("exit", () => { if (!settled) finish(new Error("Document reader stopped before completing.")); });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
