import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { sessionRouter } from "./routes/session.js";
import { avatarProxyRouter } from "./routes/avatarProxy.js";
import { createWsHandler } from "./websocket/wsHandler.js";
import { WS_PROTOCOL_VERSION } from "./types/index.js";

const app = express();
const avatarPublicDir =
  process.env.AVATAR_PUBLIC_DIR ?? join(process.cwd(), "..", "client", "public", "avatars");

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/avatars", express.static(avatarPublicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "proxim-server" });
});

app.use("/assets", avatarProxyRouter);
app.use("/session", sessionRouter);

const server = createServer(app);
const wss = new WebSocketServer({ server });
const handleWs = createWsHandler();

wss.on("connection", (ws) => {
  // Tiny handshake so clients can detect stale bundles / mismatched deployments.
  ws.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: WS_PROTOCOL_VERSION,
      service: "proxim-server",
    })
  );
  ws.on("message", (data) => {
    void handleWs(ws, String(data));
  });
});

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
  console.log(`Proxim server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
