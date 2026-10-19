import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import transcriptionRouter from "./transcription";
import desktopAuthRouter from "./desktop-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(transcriptionRouter);
router.use(desktopAuthRouter);

export default router;
