import { createHash, timingSafeEqual } from "node:crypto";

export const desktopAuthLifetimeMs = 5 * 60_000;
export function proofHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function matchesProof(value: string, expectedHash: string) {
  const actual = Buffer.from(proofHash(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function sameOriginApproval(origin: string | undefined, host: string | undefined, fetchSite: string | undefined) {
  if (!origin || !host || fetchSite === "cross-site") return false;
  try {
    const url = new URL(origin);
    return ["https:", "http:"].includes(url.protocol) && url.host === host;
  } catch { return false; }
}

// Bounded, transient IP counters; authorization security does not depend on these.
export function createDesktopAuthLimiter() {
  const windows = new Map<string, { count: number; expires: number }>();
  return (key: string, limit: number, now = Date.now()) => {
    for (const [k, value] of windows) if (value.expires <= now) windows.delete(k);
    const old = windows.get(key);
    if (!old && windows.size >= 10_000) return false;
    const current = old ?? { count: 0, expires: now + desktopAuthLifetimeMs };
    windows.set(key, current);
    return ++current.count <= limit;
  };
}
