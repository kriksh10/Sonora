import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import transcriptionRouter from "./transcription";
import desktopAuthRouter from "./desktop-auth";
import accessRouter from "./access";
import filesRouter from "./files";
import lifecycleRouter from "./session-lifecycle";
import { requireApprovedAccess } from "../lib/app-access";
import { createDesktopReleasesRouter } from "./desktop-releases";
import { windowsInstallerFile } from "../lib/desktop-storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);
router.use("/desktop", createDesktopReleasesRouter(requireApprovedAccess, windowsInstallerFile));
router.use(["/sessions", "/answer-preferences", "/files"], requireApprovedAccess);
router.use(filesRouter);
router.use(lifecycleRouter);
router.use(sessionsRouter);
router.use(transcriptionRouter);
router.use(desktopAuthRouter);

export default router;
