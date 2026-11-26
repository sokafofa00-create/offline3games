// Zero-dependency local HTTP server for testing the Offline Plato App locally
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");
const PLATO_FILES_DIR = path.join(__dirname, "com.plato.android", "files");
const PORT = Number(process.env.PORT || 8090);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".glsl": "text/plain; charset=utf-8",
  ".atlas": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
};

function safeJoin(base, rel) {
  const target = path.resolve(base, "." + rel);
  if (!target.startsWith(path.resolve(base))) return null;
  return target;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;

  let filePath = null;
  if (cleanPath.startsWith("/g/") || cleanPath.startsWith("/assets/")) {
    filePath = safeJoin(PLATO_FILES_DIR, cleanPath);
  } else {
    filePath = safeJoin(WEB_DIR, cleanPath);
  }

  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Offline Games Local Server running at http://127.0.0.1:${PORT}`);
});
