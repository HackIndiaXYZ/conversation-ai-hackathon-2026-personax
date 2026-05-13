import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "src", "config", "personas.json");
const destDir = path.join(root, "dist", "config");
const dest = path.join(destDir, "personas.json");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
