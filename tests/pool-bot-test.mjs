// Pool vs computer (internal-API driven human seat 0 shoots; the bot seat acts by itself). Not real-touch gameplay.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8094;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const SHOT_DIR = process.env.SHOT_DIR || "shots"; fs.mkdirSync(SHOT_DIR, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const results = [];
for (const diff of ["easy", "hard"]) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [], ext = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") errors.push("worker-console: " + m.text().slice(0, 160)); }));
  page.on("request", (r) => { if (!r.url().startsWith(`http://localhost:${PORT}/`) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) ext.push(r.url()); });
  page.on("dialog", async (d) => { errors.push("dialog: " + d.message()); await d.dismiss(); });
  const res = { name: "pool-bot-" + diff, steps: {}, timeline: [] };
  try {
    await page.addInitScript(() => { window.AndroidHost = { vibrate() {}, setOrientation() {} }; });
    await page.goto(`http://localhost:${PORT}/`);
    await page.click('.mode-tab[data-mode="bot"]');
    await page.selectOption("#bot-difficulty", diff);
    await page.click("#start-btn");
    await page.waitForSelector("#game-screen.active", { timeout: 60000 });
    await page.waitForFunction(() => !!window.__ACTIVE_SESSION__?.getClientLogic?.()?.table, null, { timeout: 90000 });
    await page.waitForTimeout(6000);
    const snap = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const b = window.__BOTS__; const bs = l.table.balls.map((x) => (x.isPocketed() ? "P" : x.position.map((v) => Math.round(v * 100) / 100).join(","))); return { seat: l._localSeat, turn: JSON.stringify(l.turn), paused: l.paused, over: !!l.gameOver, cue: l.table.cueBall.position.map((v) => Math.round(v * 100) / 100), balls: bs.join("|"), pocketed: bs.filter((x) => x === "P").length, botActs: b ? b.log.filter((x) => x.acted).length : -1, botErrs: b ? b.log.filter((x) => x.err).map((x) => x.err).slice(0, 3) : [] }; });
    res.start = await snap();
    let humanShots = 0;
    for (let k = 0; k < 40; k++) {
      const s = await snap();
      if (s.over) break;
      if (s.seat === 0 && s.turn === "[0]" && !s.paused) {
        const r = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); if (!l.canShoot(0)) return { skip: true }; if (l.canMoveCueBall && l.canMoveCueBall(0)) { l.requestCueBallMove([l.table.cueBall.position[0], l.table.cueBall.position[1]]); return { placed: true }; } const nb = l.table.balls.filter((b) => !b.isPocketed())[0]; const c = l.table.cueBall.position; l.requestShot(0.9, Math.atan2(nb.position[1] - c[1], nb.position[0] - c[0]), [0, 0]); return { shot: true }; });
        if (r.shot) humanShots++;
        res.timeline.push({ k, who: "human", r });
      }
      if (s.botActs >= 3 && humanShots >= 2) break;
      await page.waitForTimeout(3000);
    }
    res.final = await snap();
    res.humanShots = humanShots;
    res.steps.botActed = res.final.botActs > 0;
    res.steps.ballsMovedAfterStart = res.final.balls !== res.start.balls;
    await page.screenshot({ path: `${SHOT_DIR}/pool-bot-${diff}.png` });
  } catch (e) { res.steps.exception = String(e && e.message).slice(0, 300); }
  res.errors = errors; res.externalRequests = ext;
  results.push(res); await ctx.close();
}
await browser.close(); server.kill();
const out = JSON.stringify(results, null, 1);
console.log("POOL_BOT_RESULTS " + out.length);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Pool bot results\n```json\n" + out + "\n```\n");
const bad = results.filter((r) => r.steps.exception || r.externalRequests.length || !r.steps.botActed || r.errors.some((e) => !/Cannot stream music/.test(e)));
if (bad.length) { console.log("FAILED: " + bad.map((b) => b.name).join(", ")); process.exit(1); }
