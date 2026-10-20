const CHUNK_BYTES = 4 * 1024 * 1024;

class DownloadError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

/** Never save a truncated/error response as an EXE. Every range is approval-gated. */
export async function fetchInstaller(
  url: string,
  release: { sizeBytes: number; sha256: string },
  options: {
    signal: AbortSignal;
    onProgress: (received: number, total: number) => void;
    fetcher?: typeof fetch;
  },
): Promise<Blob> {
  if (!Number.isSafeInteger(release.sizeBytes) || release.sizeBytes <= 0 ||
      release.sizeBytes > 512 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(release.sha256)) {
    throw new DownloadError("Installer metadata is invalid. Refresh this page.");
  }
  const fetcher = options.fetcher ?? fetch;
  const chunks: ArrayBuffer[] = [];
  options.onProgress(0, release.sizeBytes);
  for (let start = 0; start < release.sizeBytes; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES - 1, release.sizeBytes - 1);
    for (let attempt = 0; ; attempt++) {
      options.signal.throwIfAborted();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 60_000);
      try {
        const response = await fetcher(url, {
          credentials: "include", cache: "no-store", signal: controller.signal,
          headers: { Range: `bytes=${start}-${end}` },
        });
        if (response.status === 401 || response.status === 403) {
          throw new DownloadError("Sign in with a currently approved Sonora account, then retry.");
        }
        if (response.status >= 500 || response.status === 429) {
          throw new DownloadError("Installer storage is temporarily unavailable.", true);
        }
        if (response.status !== 206 ||
            response.headers.get("Content-Range") !== `bytes ${start}-${end}/${release.sizeBytes}`) {
          await response.body?.cancel();
          throw new DownloadError("The server does not support this download yet. Publish the latest update, then refresh this page.");
        }
        const data = await response.arrayBuffer();
        if (data.byteLength !== end - start + 1) {
          throw new DownloadError("The installer transfer was incomplete.", true);
        }
        chunks.push(data);
        options.onProgress(end + 1, release.sizeBytes);
        break;
      } catch (error) {
        options.signal.throwIfAborted();
        if ((error instanceof DownloadError && !error.retryable) || attempt >= 2) {
          throw error instanceof DownloadError ? error
            : new DownloadError("Download interrupted after retries. Check your connection and try again.");
        }
      } finally {
        clearTimeout(timeout);
        options.signal.removeEventListener("abort", cancel);
      }
    }
  }
  const blob = new Blob(chunks, { type: "application/octet-stream" });
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  options.signal.throwIfAborted();
  const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== release.sha256) {
    throw new DownloadError("Installer verification failed. No file was saved. Please retry.");
  }
  return blob;
}
