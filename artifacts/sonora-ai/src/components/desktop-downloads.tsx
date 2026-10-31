import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, Info, RefreshCw } from "lucide-react";
import { getDesktopRelease, type DesktopRelease } from "@workspace/api-client-react";
import { installerDownloadPath } from "@/lib/installer-download";

const statusText = { unavailable: "Unavailable", preview: "Preview, untested", verified: "Tested release" } as const;

export default function DesktopDownloads() {
  const [release, setRelease] = useState<DesktopRelease | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getDesktopRelease({ cache: "no-store", credentials: "include" });
      if (!data || !Array.isArray(data.builds)) throw new Error("Malformed release data");
      setRelease(data);
    } catch {
      setRelease(null);
      setError("Could not load installers. Storage may be temporarily unavailable; please retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isPublicRoute = typeof window !== "undefined" && window.location.pathname.replace(import.meta.env.BASE_URL.replace(/\/$/, ""), "").startsWith("/download");

  return (
    <section data-testid="section-desktop-downloads" className="mx-auto w-full max-w-[720px] px-4 py-6 text-[#e7e8eb]">
      {isPublicRoute && (
        <a href={import.meta.env.BASE_URL} data-testid="link-download-home" className="mb-5 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
          <ArrowLeft size={15} /> Back to home
        </a>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-white">Sonora desktop</h1>
      <p className="mt-2 text-sm leading-6 text-white/55">
        The desktop app is a window around the hosted Sonora workspace. It needs an internet connection and a signed-in account. No installers are published unless one is listed below.
      </p>

      <div className="mt-5 space-y-3" aria-live="polite">
        {loading && (
          <div role="status" aria-busy="true" data-testid="status-downloads-loading" className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#17181b] p-4">
            <span className="auth-spinner" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-white">Loading desktop installers</p>
              <p className="mt-1 text-xs text-white/50">Checking which builds are available.</p>
            </div>
          </div>
        )}
        {!loading && error && (
          <div role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
            <button onClick={() => void load()} data-testid="button-retry-downloads" className="ml-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300/30 px-2.5 py-1 text-xs hover:bg-red-500/10">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}
        {!loading && release && (
          <>
            <p className="text-xs text-white/40" data-testid="text-release-version">
              Version {release.version} · {release.publishedAt ? `published ${new Date(release.publishedAt).toLocaleDateString()}` : "not published yet"}
            </p>
            {release.builds.length === 0 && <p className="rounded-xl border border-white/10 bg-[#17181b] p-4 text-sm text-white/55">No builds are listed.</p>}
            {release.builds.map((b) => {
              const live = !!installerDownloadPath(b.url, import.meta.env.BASE_URL) && (b.status === "preview" || b.status === "verified");
              const key = `${b.platform}-${b.architecture}`;
              return (
                <article key={key} data-testid={`card-build-${key}`} className="rounded-xl border border-white/10 bg-[#17181b] p-4 transition-colors hover:border-white/20">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-white">{b.label}</h2>
                      <p className="mt-1 text-xs text-white/45">{b.platform === "mac" ? "macOS" : "Windows"} · {b.architecture} · requires {b.minimumOs}</p>
                    </div>
                    <span className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${b.status === "verified" ? "bg-emerald-500/15 text-emerald-200" : b.status === "preview" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-white/50"}`}>
                      {statusText[b.status]}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-white/50">Signing: {b.signing}</p>
                  {b.sizeBytes !== null && <p className="mt-1 text-xs text-white/50">Size: {(b.sizeBytes / 1024 / 1024).toFixed(1)} MiB · No sign-in needed to download</p>}
                  {b.sha256 && <p className="mt-1 break-all font-mono text-[10px] text-white/35">SHA-256 {b.sha256}</p>}
                  <div className="mt-3">
                    {live ? (
                      <a href={installerDownloadPath(b.url, import.meta.env.BASE_URL) ?? undefined} data-testid={`link-download-${key}`} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#257c3c] px-4 text-sm font-semibold text-white hover:bg-[#2c9147]">
                        <Download size={15} /> Download {b.status === "preview" ? "preview" : ""}
                      </a>
                    ) : (
                      <span data-testid={`status-pending-${key}`} className="inline-flex min-h-[40px] items-center rounded-lg border border-dashed border-white/15 px-4 text-sm text-white/45">
                        {b.status === "unavailable" ? "Unavailable" : "Download link pending"}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </>
        )}
      </div>
      <div className="mt-6 flex gap-3 rounded-xl border border-white/10 bg-[#101113] p-4 text-xs leading-5 text-white/50">
        <Info size={15} className="mt-0.5 shrink-0 text-white/40" />
        <ul className="space-y-1.5">
          <li>Preview builds have not been through full testing; only a tested release has been verified on its listed OS.</li>
          <li>The download link redirects to the published GitHub release, so the installer is not streamed through this site. Compare the SHA-256 above with the file you save. Unsigned builds can trigger a Windows SmartScreen warning.</li>
            <li>Allow microphone or system-audio access when prompted. System audio can include other apps, not just the call. Native Mac system audio requires macOS 14.4 or newer.</li>
          <li>The Windows package contents have been inspected, but Windows launch and real-device audio have not been verified here. This is a preview, not a fully tested release.</li>
          <li>Audio is transcribed in short Gemini-processed chunks, not word by word. Desktop sign-in uses your regular browser and an explicit app connection.</li>
          <li>Screen share exclusion is best effort. Apps and macOS ScreenCaptureKit may still capture the window.</li>
        </ul>
      </div>
    </section>
  );
}
