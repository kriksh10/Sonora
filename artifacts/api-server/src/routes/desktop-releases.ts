import { Router } from "express";
import type { File } from "@google-cloud/storage";
import { pipeline } from "node:stream/promises";
import type { DesktopRelease } from "@workspace/api-zod";
import release from "../lib/windows-release.json";

/** Public installer delivery; using the application still requires approved access. */
export function createDesktopReleasesRouter(
  getFile: () => Pick<File, "getMetadata" | "createReadStream">,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set({
      "Cache-Control": "private, no-store",
      "Vary": "Cookie, Authorization",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  const checkedFile = async () => {
    const file = getFile();
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== release.sizeBytes || metadata.metadata?.sha256 !== release.sha256) {
      throw new Error("Installer metadata does not match the release.");
    }
    return file;
  };
  router.get("/releases", async (req, res): Promise<void> => {
    try {
      await checkedFile();
      const payload: DesktopRelease = {
        version: release.version, publishedAt: null,
        builds: [{
          platform: "windows", architecture: "x64", label: "Sonora for Windows",
          status: "preview", url: "/api/desktop/installers/windows-x64",
          sha256: release.sha256, sizeBytes: release.sizeBytes,
          signing: release.signing, minimumOs: release.minimumOs,
        }, ...(["arm64", "x64"] as const).map(architecture => ({
          platform: "mac" as const, architecture, label: `Sonora for Mac · ${architecture === "arm64" ? "Apple Silicon" : "Intel"}`,
          status: "unavailable" as const, url: null, sha256: null, sizeBytes: null,
          signing: "Not built or notarized", minimumOs: "macOS 14.4+ for native system audio",
        }))],
      };
      res.json(payload);
    } catch {
      req.log?.warn("Private Windows installer is unavailable");
      res.status(503).json({ error: "The installer is temporarily unavailable. Please retry later." });
    }
  });
  // Express also routes HEAD through this public handler.
  router.get("/installers/windows-x64", async (req, res): Promise<void> => {
    let file: ReturnType<typeof getFile>;
    try { file = await checkedFile(); }
    catch {
      req.log?.warn("Private Windows installer is unavailable");
      res.status(503).json({ error: "The installer is temporarily unavailable. Please retry later." });
      return;
    }
    // Small range requests avoid fragile single large proxy transfers.
    const range = req.get("Range");
    let start = 0, end = release.sizeBytes - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        if (!match[1]) start = Math.max(0, release.sizeBytes - Number(match[2]));
        else {
          start = Number(match[1]);
          if (match[2]) end = Math.min(Number(match[2]), end);
        }
      } else start = -1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
          start >= release.sizeBytes || end < start) {
        res.set("Content-Range", `bytes */${release.sizeBytes}`);
        res.status(416).end();
        return;
      }
      res.status(206);
      res.set("Content-Range", `bytes ${start}-${end}/${release.sizeBytes}`);
    }
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${release.filename}"`,
      "Content-Length": String(end - start + 1),
      "X-Installer-SHA256": release.sha256,
      "Accept-Ranges": "bytes",
      "ETag": `"${release.sha256}"`,
    });
    if (req.method === "HEAD") { res.end(); return; }
    // GCS cannot validate a whole-object CRC on a partial range. The download client
    // verifies the assembled SHA-256 against the pinned release before saving.
    const input = file.createReadStream(range
      ? { start, end, validation: false }
      : { validation: "crc32c" });
    const disconnect = () => { if (!res.writableFinished) input.destroy(); };
    res.once("close", disconnect);
    try { await pipeline(input, res); }
    catch (error) {
      const cause = error as { name?: string; code?: string };
      req.log?.warn({ errorName: cause.name, errorCode: cause.code, start, end,
        clientDisconnected: req.destroyed }, "Installer download interrupted");
      if (!res.headersSent && !res.destroyed) {
        res.removeHeader("Content-Length");
        res.removeHeader("Content-Disposition");
        res.status(503).json({ error: "Installer download failed. Please retry." });
      }
    } finally { res.off("close", disconnect); }
  });
  return router;
}
