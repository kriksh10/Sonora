import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata.internal"]);

export function blockedAddress(address: string) {
  const ip = address.toLowerCase();
  if (ip === "::1" || ip === "0.0.0.0" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function publicUrl(raw: string, lookupHost: (host: string) => Promise<string[]>) {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new Error("That job link is not a valid address."); }
  if (url.protocol !== "https:") throw new Error("Use an https job link.");
  if (url.username || url.password) throw new Error("Remove the sign-in from the job link.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("That job link is not a public page.");
  }
  const addresses = isIP(host) ? [host] : await lookupHost(host);
  if (!addresses.length || addresses.some(blockedAddress)) throw new Error("That job link is not a public page.");
  return url;
}

export async function readPublicJobPage(raw: string, options: {
  fetchPage?: typeof fetch;
  lookupHost?: (host: string) => Promise<string[]>;
} = {}) {
  const fetchPage = options.fetchPage ?? fetch;
  const lookupHost = options.lookupHost ?? (async host => (await lookup(host, { all: true })).map(item => item.address));
  let current = await publicUrl(raw, lookupHost);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetchPage(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "text/html,text/plain", "user-agent": "SonoraJobImport" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("The job page redirected without a destination.");
      current = await publicUrl(new URL(next, current).toString(), lookupHost);
      continue;
    }
    if (!response.ok) throw new Error("The job page could not be read. Paste the description instead.");
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain/.test(type)) throw new Error("That link is not a text job page. Paste the description instead.");
    const body = await response.text();
    const text = (type.includes("html") ? htmlToText(body) : body).replace(/\s+/g, " ").trim().slice(0, 8_000);
    if (text.length < 40) throw new Error("That page did not include a job description. Paste it instead.");
    return text;
  }
  throw new Error("The job page redirected too many times.");
}
