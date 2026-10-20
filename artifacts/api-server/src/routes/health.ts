import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok", desktopAuthProtocol: 1, desktopAudioProtocol: 2, desktopAnswerProtocol: 1 });
  res.json(data);
});

export default router;
