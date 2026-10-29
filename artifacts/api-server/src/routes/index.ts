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

const router: IRouter = Router();

router.use(healthRouter);
router.use(desktopReleasesRouter);
router.use(accessRouter);
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
