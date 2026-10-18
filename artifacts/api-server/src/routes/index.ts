import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import transcriptionRouter from "./transcription";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(transcriptionRouter);

export default router;
