// Computer-player test (internal-API driven human seat 0; the bot seat acts by itself). Not real-touch gameplay.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8091;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const SHOT_DIR = process.env.SHOT_DIR || "shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const scenarios = [
  { name: "brawlbots-bot-easy", game: "brawlbots", diff: "easy", vp: { width: 860, height: 412 } },
  { name: "brawlbots-bot-hard", game: "brawlbots", diff: "hard", vp: { width: 860, height: 412 } },
  { name: "monsters-bot-medium", game: "monsters", diff: "medium", vp: { width: 412, height: 860 } },
];
const results = [];
for (const sc of scenarios) {
  const ctx = await browser.newContext({ viewport: sc.vp, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [], failed = [], ext = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") errors.push("worker-console: " + m.text()); }));
  page.on("request", (r) => { if (!r.url().startsWith(`http://localhost:${PORT}/`) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) ext.push(r.url()); });
  page.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url().replace(`http://localhost:${PORT}`, "")); });
  page.on("dialog", async (d) => { errors.push("dialog: " + d.message()); await d.dismiss(); });
  const res = { name: sc.name, steps: {} };
  try {
    await page.addInitScript(() => { window.__DEBUG_HOTSEAT__ = true; window.AndroidHost = { vibrate() {}, setOrientation(m) { (window.__ORI_HOST__ = window.__ORI_HOST__ || []).push(m); } }; });
    await page.goto(`http://localhost:${PORT}/`);
    await page.click(`.game-tab[data-game="${sc.game}"]`);
    await page.click('.mode-tab[data-mode="bot"]');
    await page.selectOption("#bot-difficulty", sc.diff);
    res.steps.difficultyVisible = await page.locator("#difficulty-box").isVisible();
    await page.click("#start-btn");
    await page.waitForSelector("#game-screen.active", { timeout: 60000 });
    await page.waitForFunction(() => !!window.__ACTIVE_SESSION__, null, { timeout: 90000 });
    await page.waitForTimeout(6000);
    res.steps.coverEverVisible = false;
    const cover = async () => { if (await page.locator("#pass-cover").isVisible()) res.steps.coverEverVisible = true; };
    const snap = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const b = window.__BOTS__; return { seat: l._localSeat, turn: JSON.stringify(l.turn), paused: l.paused, phase: l.gamePhase, moves: l.moveCount, botActs: b ? b.log.filter((x) => x.acted).length : -1, botErrs: b ? b.log.filter((x) => x.err).map((x) => x.err).slice(0, 3) : [] }; });
    res.start = await snap();
    res.timeline = [];
    if (sc.game === "brawlbots") {
      for (let k = 0; k < 6; k++) {
        const r = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const seat = 0; if (l._localSeat !== seat) return { skip: true, seat: l._localSeat }; const o = { seat }; try { if (!l.worldMap.tanksSelected(true) && l.canSelectTank(seat, 0)) { const own = []; for (let i = 0; i < 16; i++) { try { if (l.isTankOwned(seat, i)) own.push(i); } catch (e) {} } o.pick = l.localMove({ a: 1, t: own[0] }); } else if (l.canShoot(seat, true)) { o.shot = l.localMove({ a: 5, i: [2.476, 1.694], p: 0, f: 0, u: false }, false); } } catch (e) { o.err = String(e && e.message).slice(0, 120); } return o; });
        await page.waitForTimeout(4000); await cover();
        res.timeline.push({ k, r, s: await snap() });
      }
    } else {
      for (let k = 0; k < 8; k++) {
        const r = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const seat = 0; if (l._localSeat !== seat) return { skip: true, seat: l._localSeat }; const o = { seat, phase: l.gamePhase }; try { if (l.gamePhase === 0) { const p = l.plugins()[0]; for (let n = 0; n < 8 && !p.canConfirm(seat); n++) { const idx = p.selectable.findIndex((m) => m.sku !== 0 && p.canSelect(seat, m.key) && !p.selecting[seat].some((x) => x && x.key === m.key) && !p.confirmed[seat].some((x) => x && x.key === m.key)); if (idx < 0) break; p.moveSelect(p.selectable[idx], p.selecting[seat].length + p.confirmed[seat].length); } if (p.canConfirm(seat)) o.confirm = p.moveConfirm(); } } catch (e) { o.err = String(e && e.message).slice(0, 120); } return o; });
        await page.waitForTimeout(5000); await cover();
        res.timeline.push({ k, r, s: await snap() });
      }
    }
    res.final = await snap();
    res.steps.botActed = res.final.botActs > 0;
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}.png` });
    res.steps.hudText = (await page.textContent("#turn-text"))?.trim();
  } catch (e) { res.steps.exception = String(e && e.message).slice(0, 300); }
  res.errors = errors; res.failedUrls = failed.slice(0, 20); res.externalRequests = ext;
  results.push(res);
  await ctx.close();
}
await browser.close(); server.kill();
const out = JSON.stringify(results, null, 1);
console.log("BOT_RESULTS " + out.length);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Bot results\n```json\n" + out + "\n```\n");
const bad = results.filter((r) => r.steps.exception || r.errors.length || r.externalRequests.length || !r.steps.botActed || r.steps.coverEverVisible);
if (bad.length) { console.log("FAILED: " + bad.map((b) => b.name).join(", ")); process.exit(1); }
