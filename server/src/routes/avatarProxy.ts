import { Router, type Request, type Response } from "express";
import multer from "multer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const avatarProxyRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const avatarPublicDir =
  process.env.AVATAR_PUBLIC_DIR ?? join(process.cwd(), "..", "client", "public", "avatars");

/**
 * Upload a local avatar GLB so the client can load it from localhost even when external CDNs are blocked.
 *
 * POST /assets/upload-avatar (multipart/form-data, fields: `file`, optional `personaId`)
 * -> { url: "/avatars/uploaded-avatar-<personaId>.glb" }
 */
avatarProxyRouter.post("/upload-avatar", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "missing file" });
      return;
    }
    const extOk = (file.originalname || "").toLowerCase().endsWith(".glb") || file.mimetype === "model/gltf-binary";
    if (!extOk) {
      res.status(400).json({ error: "please upload a .glb file" });
      return;
    }

    // Write into the Vite public folder so the client can fetch it directly.
    // Repo layout: server/src/routes -> ../../.. -> repo root -> client/public/avatars
    mkdirSync(avatarPublicDir, { recursive: true });
    const personaId = typeof req.body?.personaId === "string" ? req.body.personaId : "";
    const safePersonaId = personaId.replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
    const filename = safePersonaId ? `uploaded-avatar-${safePersonaId}.glb` : "uploaded-avatar.glb";
    const targetPath = join(avatarPublicDir, filename);
    writeFileSync(targetPath, file.buffer);

    res.json({ url: `/avatars/${filename}` });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "upload failed" });
  }
});

function rpmUpstreamUrl(id: string, query: Request["query"]): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const one of v) {
        if (one != null) qs.append(k, String(one));
      }
    } else {
      qs.append(k, String(v));
    }
  }
  return `https://models.readyplayer.me/${id}.glb${qs.toString() ? `?${qs.toString()}` : ""}`;
}

/**
 * Proxies Ready Player Me GLB downloads through our server.
 *
 * Why: some networks block the browser from fetching `https://models.readyplayer.me/...`
 * which makes the avatar appear "missing". Fetching server-side avoids those browser
 * restrictions and keeps the client on same-origin `localhost:3001`.
 *
 * Usage:
 *   GET /assets/rpm/<avatarId>.glb?<original query params>
 *   HEAD — same status/headers as GET without streaming the body (client preflight).
 */
async function handleRpmProxy(req: Request, res: Response, method: "GET" | "HEAD"): Promise<void> {
  try {
    const id = String(req.params.id || "").trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      res.status(400).send("invalid avatar id");
      return;
    }

    const url = rpmUpstreamUrl(id, req.query);

    const upstream = await fetch(url, {
      method,
      headers: { Accept: "model/gltf-binary,application/octet-stream,*/*" },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      res.status(upstream.status).send(text || `RPM proxy failed: ${upstream.status}`);
      return;
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "model/gltf-binary");
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (method === "HEAD") {
      res.status(200).end();
      return;
    }

    const body = upstream.body as unknown;
    if (body && typeof (body as any).pipe === "function") {
      (body as any).pipe(res);
      return;
    }
    if (body && typeof (body as any).getReader === "function") {
      const reader = (body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (e) {
    res.status(502).send(e instanceof Error ? e.message : "RPM proxy failed");
  }
}

avatarProxyRouter.head("/rpm/:id.glb", (req, res) => {
  void handleRpmProxy(req, res, "HEAD");
});

avatarProxyRouter.get("/rpm/:id.glb", (req, res) => {
  void handleRpmProxy(req, res, "GET");
});

