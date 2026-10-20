// Run from the API package: node scripts/upload-desktop-installer.mjs /path/to/installer.exe
// Uploads only the pinned, reviewed installer to PRIVATE storage. Never prints credentials.
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";

const release = JSON.parse(await readFile(new URL("../src/lib/windows-release.json", import.meta.url), "utf8"));
const filename = process.argv[2];
if (!filename) throw new Error("Supply the reviewed Windows installer path.");
const stat = fs.statSync(filename);
const hash = createHash("sha256");
for await (const data of fs.createReadStream(filename)) hash.update(data);
if (stat.size !== release.sizeBytes || hash.digest("hex") !== release.sha256) {
  throw new Error("Installer size or SHA-256 does not match the reviewed release.");
}
const dir = process.env.PRIVATE_OBJECT_DIR;
if (!dir) throw new Error("Private storage is not configured.");
const parts = dir.replace(/^\/+|\/+$/g, "").split("/");
const bucket = parts.shift();
if (!bucket || !parts.length) throw new Error("Private storage is not configured.");
const storage = new Storage({
  projectId: "",
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token", type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    }, universe_domain: "googleapis.com",
  },
});
const file = storage.bucket(bucket).file(`${parts.join("/")}/desktop/releases/${release.sha256}/${release.filename}`);
await pipeline(fs.createReadStream(filename), file.createWriteStream({
  resumable: true, validation: "crc32c",
  metadata: {
    contentType: "application/octet-stream", cacheControl: "private, no-store",
    metadata: { sha256: release.sha256, version: release.version },
  },
}));
// Check uploaded bytes, not just supplied metadata; avoids trusting a partial upload.
const remoteHash = createHash("sha256");
let bytes = 0;
for await (const data of file.createReadStream({ validation: "crc32c" })) {
  bytes += data.length; remoteHash.update(data);
}
if (bytes !== release.sizeBytes || remoteHash.digest("hex") !== release.sha256) {
  throw new Error("Uploaded installer verification failed.");
}
console.log(`Private installer uploaded and byte-verified: ${release.filename}, ${bytes} bytes, SHA-256 ${release.sha256}`);
