import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readInstalledOrtVersion() {
  const candidates = [
    join(__dirname, "node_modules", "onnxruntime-web", "package.json"),
    join(__dirname, "node_modules", "@ricky0123", "vad-web", "node_modules", "onnxruntime-web", "package.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const v = JSON.parse(readFileSync(p, "utf8"));
      if (v.version) return v.version;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    "[proxim] Could not read onnxruntime-web version. Run `npm install` in the client folder (onnxruntime-web is a direct dependency)."
  );
}

const ortWasmVersion = readInstalledOrtVersion();

function createRpmProxyMiddleware() {
  return (req, res, next) => {
    const raw = req.url ?? "";
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!raw.startsWith("/__rpm/") || !raw.includes(".glb")) return next();

    const pathAndQuery = raw.replace(/^\/__rpm/, "");
    const upstream = `https://models.readyplayer.me${pathAndQuery}`;

    void fetch(upstream, {
      method: req.method,
      headers: { Accept: "model/gltf-binary,application/octet-stream,*/*" },
    })
      .then(async (r) => {
        res.statusCode = r.status;
        const ct = r.headers.get("content-type");
        if (ct) res.setHeader("Content-Type", ct);
        const cc = r.headers.get("cache-control");
        if (cc) res.setHeader("Cache-Control", cc);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(t || `upstream ${r.status}`);
          return;
        }
        const buf = Buffer.from(await r.arrayBuffer());
        res.end(buf);
      })
      .catch((e) => {
        res.statusCode = 502;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(e instanceof Error ? e.message : "RPM proxy failed");
      });
  };
}

function rpmProxyVitePlugin() {
  const handle = createRpmProxyMiddleware();
  const prepend = (server) => {
    const stack = server.middlewares.stack;
    if (Array.isArray(stack)) {
      stack.unshift({ route: "", handle });
    } else {
      server.middlewares.use(handle);
    }
  };

  return {
    name: "proxim-rpm-proxy",
    configureServer(server) {
      return () => prepend(server);
    },
    configurePreviewServer(server) {
      return () => prepend(server);
    },
  };
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_ORT_WASM_VERSION": JSON.stringify(ortWasmVersion),
  },
  plugins: [rpmProxyVitePlugin(), react()],
  optimizeDeps: {
    include: ["@ricky0123/vad-web"],
    exclude: ["onnxruntime-web"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  preview: {
    port: 4173,
  },
});
