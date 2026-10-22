import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapConfiguredAccess } from "./lib/bootstrap-access";
import { bindLiveSocket } from "./routes/live-audio";

function loadLocalSpeechmaticsKey() {
  if (process.env.SPEECHMATICS_API_KEY) return;
  const candidates = [
    path.resolve(process.cwd(), "secrets/speechmatics.env"),
    path.resolve(process.cwd(), "../../secrets/speechmatics.env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^(SPEECHMATICS_API_KEY)=(.*)$/.exec(line.trim());
      if (match?.[2] && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
    return;
  }
}
loadLocalSpeechmaticsKey();

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
const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", "http://localhost");
  if (url.pathname !== "/api/live-audio") { socket.destroy(); return; }
  sockets.handleUpgrade(request, socket, head, ws => {
    bindLiveSocket(url.searchParams.get("ticket") ?? "", {
      on: (event, listener) => { ws.on(event, listener); },
      send: data => ws.send(data),
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
