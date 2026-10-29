import { Router, type IRouter } from "express";
import healthRouter from "./health";
import desktopReleasesRouter from "./desktop-releases";
import sessionsRouter from "./sessions";
import transcriptionRouter from "./transcription";
import liveAudioRouter from "./live-audio";
import desktopAuthRouter from "./desktop-auth";
import accessRouter from "./access";
import filesRouter from "./files";
import lifecycleRouter from "./session-lifecycle";
import { requireApprovedAccess } from "../lib/app-access";
import billingRouter from "./billing";
import sessionToolsRouter from "./session-tools";
import { catalogForClient } from "../billing/stripe-checkout";

const router: IRouter = Router();

router.use(healthRouter);
router.use(desktopReleasesRouter);
router.use(accessRouter);
// Public commercial configuration exposes only a capability flag and catalog,
// never credentials. Actual checkout remains behind approval and authentication.
router.get("/billing/catalog", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(catalogForClient());
});
router.use(["/sessions", "/answer-preferences", "/files", "/billing"], requireApprovedAccess);
router.use(billingRouter);
router.use(sessionToolsRouter);
router.use(filesRouter);
router.use(lifecycleRouter);
router.use(sessionsRouter);
router.use(transcriptionRouter);
router.use(liveAudioRouter);
router.use(desktopAuthRouter);

export default router;
