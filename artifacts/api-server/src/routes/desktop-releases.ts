import { Router, type IRouter } from "express";

const REPO = "kriksh10/Sonora";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const METADATA_NAME = "sonora-desktop-release.json";
const TTL_MS = 5 * 60 * 1000;
const WINDOWS_MINIMUM = "Windows 11 (Windows 10 2004+ capture exclusion is best effort)";

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

type Snapshot = {
  version: string;
  publishedAt: string | null;
  filename: string | null;
  downloadUrl: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  signing: string;
  status: "unavailable" | "preview" | "verified";
};

const EMPTY: Snapshot = {
  version: "0.0.0",
  publishedAt: null,
  filename: null,
  downloadUrl: null,
  sha256: null,
  sizeBytes: null,
  signing: "Not signed",
  status: "unavailable",
};

export function windowsDownloadUrl(tag: string, filename: string) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) return null;
  if (!/^Sonora-\d+\.\d+\.\d+-win-x64\.exe$/.test(filename)) return null;
  const version = tag.slice(1);
  if (filename !== `Sonora-${version}-win-x64.exe`) return null;
  return `https://github.com/${REPO}/releases/download/${tag}/${filename}`;
}

function readMetadata(value: unknown, filename: string, version: string) {
  if (!value || typeof value !== "object") return null;
  const meta = value as Record<string, unknown>;
  if (meta.product !== "sonora" || meta.version !== version || meta.filename !== filename) return null;
  if (typeof meta.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(meta.sha256)) return null;
  const signing = typeof meta.signing === "string" && meta.signing.length > 0 && meta.signing.length <= 160
    ? meta.signing : "Not signed";
  return { sha256: meta.sha256, signing };
}

export function snapshotFromRelease(release: unknown, metadata: unknown): Snapshot {
  if (!release || typeof release !== "object") return EMPTY;
  const body = release as { tag_name?: unknown; published_at?: unknown; assets?: unknown };
  const tag = typeof body.tag_name === "string" ? body.tag_name : "";
  const version = tag.startsWith("v") ? tag.slice(1) : "";
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const exe = assets.find(asset => {
    const name = asset && typeof asset === "object" ? (asset as { name?: unknown }).name : null;
    return typeof name === "string" && windowsDownloadUrl(tag, name);
  }) as { name?: string; size?: unknown } | undefined;
  if (!exe?.name) return { ...EMPTY, publishedAt: typeof body.published_at === "string" ? body.published_at : null };
  const downloadUrl = windowsDownloadUrl(tag, exe.name);
  const described = readMetadata(metadata, exe.name, version);
  const signing = described?.signing ?? "Not signed";
  const sizeBytes = typeof exe.size === "number" && Number.isFinite(exe.size) && exe.size >= 0 ? exe.size : null;
  return {
    version: version || "0.0.0",
    publishedAt: typeof body.published_at === "string" ? body.published_at : null,
    filename: exe.name,
    downloadUrl,
    sha256: described?.sha256 ?? null,
    sizeBytes,
    signing,
    status: downloadUrl ? (signing === "Azure Trusted Signing" ? "verified" : "preview") : "unavailable",
  };
}

function releaseDocument(snapshot: Snapshot) {
  return {
    product: "sonora",
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
    builds: [
      {
        platform: "windows",
        architecture: "x64",
        label: "Sonora for Windows",
        status: snapshot.status,
        url: snapshot.downloadUrl ? "/api/desktop/installers/windows-x64" : null,
        sha256: snapshot.sha256,
        sizeBytes: snapshot.sizeBytes,
        signing: snapshot.signing,
        minimumOs: WINDOWS_MINIMUM,
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
  };
}

function githubHeaders() {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "Sonora-Desktop",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.SONORA_GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export function createDesktopReleasesRouter(options: {
  fetchImpl?: FetchLike;
  now?: () => number;
  ttlMs?: number;
} = {}): IRouter {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? TTL_MS;
  let cache: { at: number; snapshot: Snapshot } | null = null;
  const router = Router();

  async function load() {
    const time = now();
    if (cache && time - cache.at < ttlMs) return cache.snapshot;
    try {
      const latest = await fetchImpl(LATEST_URL, { headers: githubHeaders(), signal: AbortSignal.timeout(8000) });
      if (!latest.ok) throw new Error(`GitHub releases returned ${latest.status}`);
      const release = await latest.json();
      const assets = release && typeof release === "object" && Array.isArray((release as { assets?: unknown }).assets)
        ? (release as { assets: Array<{ name?: string; browser_download_url?: string }> }).assets : [];
      const metaAsset = assets.find(asset => asset?.name === METADATA_NAME);
      let metadata: unknown = null;
      if (metaAsset && typeof metaAsset.browser_download_url === "string" &&
          metaAsset.browser_download_url.startsWith(`https://github.com/${REPO}/releases/download/`)) {
        const metaResponse = await fetchImpl(metaAsset.browser_download_url, { signal: AbortSignal.timeout(8000) });
        if (metaResponse.ok) metadata = await metaResponse.json();
      }
      const snapshot = snapshotFromRelease(release, metadata);
      cache = { at: time, snapshot };
      return snapshot;
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String(error.message) : "unavailable";
      console.error("Desktop release lookup failed", message);
      if (cache) return cache.snapshot;
      return EMPTY;
    }
  }

  router.get("/desktop/releases", async (_req, res) => {
    const snapshot = await load();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(releaseDocument(snapshot));
  });

  router.get("/desktop/installers/windows-x64", async (_req, res) => {
    const snapshot = await load();
    if (!snapshot.downloadUrl) {
      res.status(404).json({ error: "The Windows installer is not published yet." });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.redirect(302, snapshot.downloadUrl);
  });

  return router;
}

const router: IRouter = createDesktopReleasesRouter();
export default router;
