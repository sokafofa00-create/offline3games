// Pool probe (diagnostic, internal API + canvas taps): break outcome/turn state and the in-game elements (shop) menu.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8096;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 140)); });
fs.mkdirSync("shots", { recursive: true });
const res = { errors, breaks: [], shop: [] };
const st = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const t = l.table; const live = t.balls.filter((b) => !b.isPocketed()); return { turn: JSON.stringify(l.turn), seat: l._localSeat, bih: l.ballInHand, breaking: l.isBreaking ? l.isBreaking() : null, illegalBreaks: l.illegalBreaks, solids: l.solids, live: live.length, cueP: t.cueBall.isPocketed(), cue: t.cueBall.position.map((x) => Math.round(x)), paused: l.paused, xs: live.map((b) => Math.round(b.position[0])).sort((a, b) => a - b).filter((_, i, a) => i === 0 || i === a.length - 1) }; });
try {
  await page.addInitScript(() => { window.AndroidHost = { vibrate() {}, setOrientation() {} }; });
  await page.goto(`http://localhost:${PORT}/`);
  await page.click("#start-btn");
  await page.waitForSelector("#game-screen.active", { timeout: 60000 });
  await page.waitForFunction(() => !!window.__ACTIVE_SESSION__?.getClientLogic?.()?.table, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  res.pillVisible = await page.locator("#turn-pill").isVisible();
  res.start = await st();
  await page.screenshot({ path: "shots/probe-1-start.png" });
  for (let n = 0; n < 4; n++) {
    const before = await st();
    const r = await page.evaluate((n) => { const l = window.__ACTIVE_SESSION__.getClientLogic(); try { if (!l.canShoot(l._localSeat)) return { skip: true }; const nb = l.table.balls.filter((b) => !b.isPocketed())[0]; const c = l.table.cueBall.position; const ang = Math.atan2(nb.position[1] - c[1], nb.position[0] - c[0]); l.requestShot(n === 0 ? 0.95 : 0.3, ang, [0, 0]); return { shot: true, as: l._localSeat, strength: n === 0 ? 0.95 : 0.3 }; } catch (e) { return { err: String(e && e.message).slice(0, 100) }; } }, n);
    let last = before; let moved = false; let still = 0; const t0 = Date.now(); let lastKey = "";
    while (Date.now() - t0 < 60000) { await page.waitForTimeout(300); last = await st(); const key = JSON.stringify([last.live, last.cue, last.xs]); if (key !== lastKey) { moved = true; still = 0; lastKey = key; } else if (moved) still++; if (moved && still >= 6 && !last.paused) break; }
    await page.waitForTimeout(4000);
    const after = await st();
    res.breaks.push({ n, r, before, after });
    await page.screenshot({ path: `shots/probe-2-after-shot${n}.png` });
    if (r.skip || r.err) break;
  }
  // in-game elements (shop) menu: the star at the left edge
  await page.screenshot({ path: "shots/probe-3-before-shop.png" });
  for (const [name, x, y] of [["elements", 25, 440]]) {
    await page.touchscreen.tap(x, y); await page.waitForTimeout(3000);
    await page.screenshot({ path: `shots/probe-4-shop-${name}.png` });
    res.shop.push({ name, x, y });
  }
} catch (e) { res.exception = String(e && e.message).slice(0, 300); }
await page.screenshot({ path: "shots/probe-9-end.png" }).catch(() => {});
await browser.close(); server.kill();
const out = JSON.stringify(res, null, 1);
console.log("POOL_PROBE_RESULTS " + out.length);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Pool probe\n```json\n" + out + "\n```\n");
console.log(out);
