// Zero-dependency local HTTP server for testing the Offline Plato App locally
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");
const PLATO_FILES_DIR = path.join(__dirname, "com.plato.android", "files");
const PORT = Number(process.env.PORT || 8090);

// Resource folders uploaded by file name (not by hash). Each one has a __assets.json manifest (name -> SHA-1);
// /assets/<hash> is answered from the named file. Same mapping the Android build uses. No network involved.
const NAMED_ASSET_DIRS = ["match_monsters_assets", "brawlbots_assets", "pool_assets"];
const hashToFile = new Map();
for (const dir of NAMED_ASSET_DIRS) {
  const manifest = path.join(__dirname, dir, "__assets.json");
  if (!fs.existsSync(manifest)) continue;
  const map = JSON.parse(fs.readFileSync(manifest, "utf8"));
  for (const [name, hash] of Object.entries(map)) hashToFile.set(hash, path.join(__dirname, dir, name));
}

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

// --- Dev/CI only: a stand-in for the native LAN transport so two browser contexts can exercise the lobby protocol. ---
// It is NOT packaged into the APK path that matters (the app uses the native LanNet there).
const lanPeers = new Map(); // id -> { id, name, state, seen, events: [] }
function lanRoute(req, res, urlPath) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let b = {};
    try { b = JSON.parse(body || "{}"); } catch (_e) {}
    const now = Date.now();
    for (const [k, p] of lanPeers) if (now - p.seen > 8000) lanPeers.delete(k);
    const out = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (urlPath === "/__lan/hello") { const p = lanPeers.get(b.id) || { id: b.id, events: [] }; Object.assign(p, { name: b.name, state: b.state || "available", seen: now }); lanPeers.set(b.id, p); return out({ ok: true }); }
    if (urlPath === "/__lan/bye") { lanPeers.delete(b.id); return out({ ok: true }); }
    if (urlPath === "/__lan/poll") {
      const me = lanPeers.get(b.id); if (me) me.seen = now;
      const peers = [...lanPeers.values()].filter((p) => p.id !== b.id).map((p) => ({ id: p.id, name: p.name, ip: "test:" + p.id, state: p.state }));
      const events = me ? me.events.splice(0) : [];
      return out({ me: { id: b.id, name: me?.name, ip: "test:" + b.id }, peers, events });
    }
    if (urlPath === "/__lan/send") { const t = lanPeers.get(b.to); if (t) t.events.push(b.msg); return out({ ok: !!t }); }
    if (urlPath === "/__lan/broadcast") { let n = 0; for (const p of lanPeers.values()) if (p.id !== b.from) { p.events.push(b.msg); n++; } return out({ n }); }
    res.writeHead(404); res.end();
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath.startsWith("/__lan/")) return lanRoute(req, res, urlPath);
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;

  let filePath = null;
  if (cleanPath.startsWith("/g/") || cleanPath.startsWith("/assets/")) {
    filePath = safeJoin(PLATO_FILES_DIR, cleanPath);
    if (cleanPath.startsWith("/assets/") && (!filePath || !fs.existsSync(filePath))) {
      const named = hashToFile.get(cleanPath.slice("/assets/".length));
      if (named) filePath = named;
    }
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
