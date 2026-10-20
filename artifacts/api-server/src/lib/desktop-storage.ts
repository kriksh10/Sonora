import { Storage } from "@google-cloud/storage";
import release from "./windows-release.json";

// Replit sidecar credentials; no credentials or signed storage URLs reach clients.
const storage = new Storage({
  projectId: "",
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
});

export function windowsInstallerFile() {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("Private installer storage is not configured.");
  const parts = privateDir.replace(/^\/+|\/+$/g, "").split("/");
  const bucket = parts.shift();
  if (!bucket || !parts.length) throw new Error("Private installer storage is not configured.");
  return storage.bucket(bucket).file(`${parts.join("/")}/desktop/releases/${release.sha256}/${release.filename}`);
}
