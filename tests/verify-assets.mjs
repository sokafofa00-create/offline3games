// Verifies a named-asset folder against its __assets.json (name -> SHA-1): file present, content hash equal, sizes summed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const dir = process.argv[2] || "match_monsters_assets";
const map = JSON.parse(fs.readFileSync(path.join(dir, "__assets.json"), "utf8"));
const res = { dir, manifestEntries: Object.keys(map).length, present: 0, missing: [], hashMismatch: [], bytes: 0 };
for (const [name, hash] of Object.entries(map)) {
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) { res.missing.push(name); continue; }
  const buf = fs.readFileSync(f);
  res.present++; res.bytes += buf.length;
  const h = crypto.createHash("sha1").update(buf).digest("hex");
  if (h !== hash) res.hashMismatch.push({ name, expected: hash, actual: h });
}
let files = 0, total = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files++; total += fs.statSync(p).size; } } };
walk(dir);
res.filesInFolder = files; res.folderBytes = total;
const out = { ...res, missing: res.missing.slice(0, 60), missingCount: res.missing.length, hashMismatch: res.hashMismatch.slice(0, 20), hashMismatchCount: res.hashMismatch.length };
console.log("ASSET_VERIFY " + JSON.stringify(out));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Asset verify (" + dir + ")\n```json\n" + JSON.stringify(out, null, 1) + "\n```\n");
