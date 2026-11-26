// Diagnoses the "[sound] Cannot stream music ... reason=10" console errors: reason 10 means decodeAudioData returned nothing.
// Hypothesis: Playwright's bundled Chromium has no AAC (m4a) decoder; Chrome / Android WebView do. Test both browsers on the same real asset.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8095;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
// Pool music: hash from the smoke error line (pool/th_basic_music.m4a)
const HASH = "1e5886c0d6b16cef3b72c964745813cb69714c03";
const out = [];
for (const [label, opts] of [["playwright-chromium", {}], ["system-chrome", { channel: "chrome" }]]) {
  const r = { label };
  try {
    const browser = await chromium.launch({ ...opts, args: ["--autoplay-policy=no-user-gesture-required"] });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    r.result = await page.evaluate(async (hash) => {
      const o = {};
      const a = document.createElement("audio");
      o.canPlay = { aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'), mp3: a.canPlayType("audio/mpeg"), ogg: a.canPlayType("audio/ogg"), mp4v: a.canPlayType('video/mp4; codecs="avc1.42E01E"') };
      try {
        const resp = await fetch(`./assets/${hash}`); o.status = resp.status;
        const bytes = await resp.arrayBuffer(); o.bytes = bytes.byteLength;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        try { const buf = await ctx.decodeAudioData(bytes.slice(0)); o.decoded = { duration: Math.round(buf.duration * 10) / 10, channels: buf.numberOfChannels }; } catch (e) { o.decodeError = String(e && e.message || e).slice(0, 120); }
      } catch (e) { o.fetchError = String(e).slice(0, 120); }
      return o;
    }, HASH);
    r.version = browser.version();
    await browser.close();
  } catch (e) { r.launchError = String(e && e.message).slice(0, 200); }
  out.push(r);
}
server.kill();
const txt = JSON.stringify(out, null, 1);
console.log("AUDIO_DIAG " + txt);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Audio decode diagnosis (music-stream errors)\n```json\n" + txt + "\n```\n");
