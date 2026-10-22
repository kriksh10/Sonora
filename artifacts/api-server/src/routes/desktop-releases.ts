import { Router, type IRouter } from "express";
import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "Sonora-0.3.5-win-x64.exe";
const SHA256 = "929ec3488ddca5fc499593a884df28fb4c1bcb4e7960a25a5560acd7d5d6dbf8";
const DOWNLOAD_PATH = "/api/desktop/installers/windows-x64";

function installerFile() {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/api-server/installers", FILE_NAME),
    path.resolve(process.cwd(), "installers", FILE_NAME),
  ];
  return candidates.find(file => fs.existsSync(file)) ?? null;
}

const router: IRouter = Router();

router.get("/desktop/releases", (_req, res) => {
  const file = installerFile();
  const size = file ? fs.statSync(file).size : 0;
  const ready = size > 0;
  res.json({
    product: "sonora",
    version: "0.3.5",
    publishedAt: "2026-10-22",
    builds: [
      {
        platform: "windows",
        architecture: "x64",
        label: "Sonora for Windows",
        status: ready ? "preview" : "unavailable",
        url: ready ? DOWNLOAD_PATH : null,
        sha256: ready ? SHA256 : null,
        sizeBytes: ready ? size : null,
        signing: "Not signed",
        minimumOs: "Windows 11 (Windows 10 2004+ capture exclusion is best effort)",
      },
      {
        platform: "mac",
        architecture: "arm64",
        label: "Sonora for Mac · Apple Silicon",
        status: "unavailable",
        url: null,
        sha256: null,
        sizeBytes: null,
        signing: "Not built or notarized",
        minimumOs: "macOS 14.4+ for native system audio",
      },
      {
        platform: "mac",
        architecture: "x64",
        label: "Sonora for Mac · Intel",
        status: "unavailable",
        url: null,
        sha256: null,
        sizeBytes: null,
        signing: "Not built or notarized",
        minimumOs: "macOS 14.4+ for native system audio",
      },
    ],
  });
});

router.get("/desktop/installers/windows-x64", (req, res) => {
  const file = installerFile();
  if (!file) {
    res.status(404).json({ error: "The Windows installer is not on this server yet." });
    return;
  }
  res.sendFile(file, {
    acceptRanges: true,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
    },
  }, error => {
    if (error && !res.headersSent) res.status(404).json({ error: "The Windows installer is not on this server yet." });
  });
});

export default router;
