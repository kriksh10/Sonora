import { Router, type RequestHandler } from "express";
import type { File } from "@google-cloud/storage";
import { pipeline } from "node:stream/promises";
import type { DesktopRelease } from "@workspace/api-zod";
import release from "../lib/windows-release.json";

/** Factory keeps authorization mandatory and makes byte delivery independently testable. */
export function createDesktopReleasesRouter(
  authorize: RequestHandler,
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
  router.use(authorize);
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
  // Express also routes HEAD through this handler, with the same approval check.
  router.get("/installers/windows-x64", async (req, res): Promise<void> => {
    let file: ReturnType<typeof getFile>;
    try { file = await checkedFile(); }
    catch {
      req.log?.warn("Private Windows installer is unavailable");
      res.status(503).json({ error: "The installer is temporarily unavailable. Please retry later." });
      return;
    }
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${release.filename}"`,
      "Content-Length": String(release.sizeBytes),
      "X-Installer-SHA256": release.sha256,
    });
    if (req.method === "HEAD") { res.end(); return; }
    const input = file.createReadStream({ validation: "crc32c" });
    const disconnect = () => { if (!res.writableFinished) input.destroy(); };
    res.once("close", disconnect);
    try { await pipeline(input, res); }
    catch {
      req.log?.warn("Installer download interrupted");
      if (!res.headersSent && !res.destroyed) {
        res.removeHeader("Content-Length");
        res.removeHeader("Content-Disposition");
        res.status(503).json({ error: "Installer download failed. Please retry." });
      }
    } finally { res.off("close", disconnect); }
  });
  return router;
}
