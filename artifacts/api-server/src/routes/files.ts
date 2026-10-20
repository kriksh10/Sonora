import { Router, raw } from "express";
import { getAuth } from "@clerk/express";
import { extractWord } from "../lib/word-extraction";
import { hasApprovedAccess } from "../lib/app-access";

const router = Router();
const active = new Set<string>();
router.post("/files/extract", (req, res, next) => {
  // Reserve before buffering: one 12 MB request per account, at most four readers globally.
  const id = getAuth(req).userId!;
  if (active.has(id) || active.size >= 4) { res.status(429).json({ error: "A document is already being read. Retry shortly." }); return; }
  active.add(id);
  let released = false;
  const release = () => { if (!released) { released = true; active.delete(id); } };
  res.once("close", release); res.once("finish", release);
  next();
}, raw({ type: "application/octet-stream", limit: "12mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ error: "Send a non-empty Word file, up to 12 MB." }); return; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  res.once("close", stop);
  try {
    const text = await extractWord(req.body, controller.signal);
    if (!await hasApprovedAccess(getAuth(req).userId!)) { res.status(403).json({ error: "Sonora access requires approval." }); return; }
    res.json({ text });
  } catch (error) {
    if (!res.destroyed) res.status(422).json({ error: error instanceof Error ? error.message : "Could not read Word file." });
  } finally { res.off("close", stop); }
});
export default router;
