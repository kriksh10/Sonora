import http from "node:http";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapConfiguredAccess } from "./lib/bootstrap-access";
import { bindLiveSocket } from "./routes/live-audio";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
const sockets = new WebSocketServer({ noServer: true, maxPayload: 3200 });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", "http://localhost");
  if (url.pathname !== "/api/live-audio") { socket.destroy(); return; }
  sockets.handleUpgrade(request, socket, head, ws => {
    bindLiveSocket(url.searchParams.get("ticket") ?? "", {
      on: (event, listener) => { ws.on(event, listener); },
      send: data => { if (ws.readyState === ws.OPEN) ws.send(data); },
      close: () => ws.close(),
    });
  });
});
server.on("error", err => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
server.listen(port, () => {
  logger.info({ port }, "Server listening");
  void bootstrapConfiguredAccess().catch(() => {
    logger.warn("Access bootstrap could not complete. Verified configured accounts can retry through sign-in; other users remain gated.");
  });
});
