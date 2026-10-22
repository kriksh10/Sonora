import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata.internal"]);

export function blockedAddress(address: string) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 6) return !/^[23]/.test(ip) || /^(2001:(?:db8|0):|2002:)/.test(ip);
  if (isIP(ip) !== 4) return true;
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
    || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0)
    || (a === 100 && b >= 64 && b <= 127);
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
  if (url.port && url.port !== "443") throw new Error("Use a public https job page on the standard port.");
  if (url.username || url.password) throw new Error("Remove the sign-in from the job link.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("That job link is not a public page.");
  }
  const addresses = isIP(host) ? [host] : await lookupHost(host);
  if (!addresses.length || addresses.some(blockedAddress)) throw new Error("That job link is not a public page.");
  return { url, addresses };
}

/** Pin the validated DNS result for the connection to prevent DNS-rebinding SSRF. */
async function fetchPublicPage(url: URL, addresses: string[]): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      lookup: (_host, options, callback) => {
        const address = addresses[0];
        if (options.all) callback(null, addresses.map(value => ({ address: value, family: isIP(value) })));
        else callback(null, address, isIP(address));
      },
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "text/html,text/plain", "user-agent": "SonoraJobImport" },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512_000) { response.destroy(); reject(new Error("The job page is too large. Paste the description instead.")); }
        else chunks.push(chunk);
      });
      response.on("error", () => reject(new Error("The job page could not be read. Paste the description instead.")));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode ?? 502,
        headers: { "content-type": String(response.headers["content-type"] ?? ""), location: String(response.headers.location ?? "") },
      })));
    });
    request.on("error", () => reject(new Error("The job page could not be read. Paste the description instead.")));
  });
}

export async function readPublicJobPage(raw: string, options: {
  fetchPage?: typeof fetch;
  lookupHost?: (host: string) => Promise<string[]>;
} = {}) {
  const lookupHost = options.lookupHost ?? (async host => (await lookup(host, { all: true })).map(item => item.address));
  let current = await publicUrl(raw, lookupHost);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = options.fetchPage ? await options.fetchPage(current.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "text/html,text/plain", "user-agent": "SonoraJobImport" },
    }) : await fetchPublicPage(current.url, current.addresses);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("The job page redirected without a destination.");
      current = await publicUrl(new URL(next, current.url).toString(), lookupHost);
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
