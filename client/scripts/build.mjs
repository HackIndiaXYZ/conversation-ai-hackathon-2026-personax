import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(__dirname, "..");

function readInstalledOrtVersion() {
  const candidates = [
    join(clientRoot, "node_modules", "onnxruntime-web", "package.json"),
    join(clientRoot, "node_modules", "@ricky0123", "vad-web", "node_modules", "onnxruntime-web", "package.json"),
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

await build(
  defineConfig({
    root: clientRoot,
    configFile: false,
    define: {
      "import.meta.env.VITE_ORT_WASM_VERSION": JSON.stringify(readInstalledOrtVersion()),
    },
    plugins: [react()],
    optimizeDeps: {
      include: ["@ricky0123/vad-web"],
      exclude: ["onnxruntime-web"],
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  })
);
