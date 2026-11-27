// Diagnostic: (A) Monsters vs-bot, both seats auto-driven, timeline of seat/displaySeat/turn plus screenshots per turn.
// (B) Pool hotseat: weak shot then settle timeline (turn, ballInHand, illegalBreaks, rack extent) plus screenshot.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8097;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
fs.mkdirSync("shots", { recursive: true });
const errors = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + (e && e.stack ? String(e.stack).slice(0, 200) : JSON.stringify(e).slice(0, 200))));
  await page.addInitScript(() => { window.AndroidHost = { vibrate() {}, setOrientation() {} }; });
  await page.goto(`http://localhost:${PORT}/`);
  return page;
}
const log = (...a) => console.log("TP", ...a);
// ---- A: Monsters vs bot
try {
  const page = await newPage();
  await page.click('.game-tab[data-game="monsters"]');
  await page.click('.mode-tab[data-mode="bot"]');
  await page.click("#start-btn");
  await page.waitForSelector("#game-screen.active", { timeout: 60000 });
  await page.waitForFunction(() => !!window.__ACTIVE_SESSION__?.getClientLogic?.(), null, { timeout: 90000 });
  await page.waitForTimeout(5000);
  await page.evaluate(async () => { const m = await import("/bots.js"); window.__HB__ = m.startBots({ getLogic: () => window.__ACTIVE_SESSION__?.getClientLogic?.(), botSeats: [0], difficulty: "medium", game: "monsters" }); });
  let last = "", shots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 100000) {
    const s = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const lock = document.getElementById("bot-lock"); return { seat: l._localSeat, disp: l.displaySeat, turn: JSON.stringify(l.turn), phase: l.gamePhase, moves: l.moveCount, hb: JSON.stringify((window.__HB__?.log||[]).slice(-2)).slice(0,200), bb: JSON.stringify((window.__BOTS__?.log||[]).slice(-1)).slice(0,120), lock: lock ? lock.style.display : "none", over: l.gameOver }; });
    const key = [s.seat, s.turn, s.phase].join("|");
    if (key !== last || Math.round((Date.now() - t0) / 1000) % 15 === 0) log(Math.round((Date.now() - t0) / 1000), JSON.stringify(s));
    if (key !== last && shots < 18) { last = key; for (const d of [600, 2500, 4000]) { await page.waitForTimeout(d); await page.screenshot({ path: `shots/mon-${String(shots++).padStart(2, "0")}-seat${s.seat}-ph${s.phase}-d${d}.png` }); } }
    await page.waitForTimeout(1500);
  }
} catch (e) { log("A exception", String(e && e.message).slice(0, 300)); }
// ---- B: Pool settle timeline
try {
  const page = await newPage();
  await page.click("#start-btn");
  await page.waitForSelector("#game-screen.active", { timeout: 60000 });
  await page.waitForFunction(() => !!window.__ACTIVE_SESSION__?.getClientLogic?.()?.table, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  const st = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const t = l.table; const live = t.balls.filter((b) => !b.isPocketed()); const xs = live.map((b) => b.position[0]); return { turn: JSON.stringify(l.turn), seat: l._localSeat, bih: l.ballInHand, brk: l.isBreaking ? l.isBreaking() : null, ill: l.illegalBreaks, live: live.length, xmin: Math.round(Math.min(...xs)), xmax: Math.round(Math.max(...xs)), cue: t.cueBall.position.map((x) => Math.round(x)) }; });
  for (let n = 0; n < 3; n++) {
    log("B before", n, JSON.stringify(await st()));
    const r = await page.evaluate((n) => { const l = window.__ACTIVE_SESSION__.getClientLogic(); try { if (!l.canShoot(l._localSeat)) return { skip: true }; const nb = l.table.balls.filter((b) => !b.isPocketed())[0]; const c = l.table.cueBall.position; const ang = Math.atan2(nb.position[1] - c[1], nb.position[0] - c[0]); l.requestShot(n === 1 ? 0.95 : 0.3, ang, [0, 0]); return { shot: true, as: l._localSeat }; } catch (e) { return { err: String(e && e.message).slice(0, 100) }; } }, n);
    log("B shot", n, JSON.stringify(r));
    if (!r.shot) break;
    for (let k = 0; k < 16; k++) { await page.waitForTimeout(700); if (k % 4 === 0 || k > 12) log("B t", n, k, JSON.stringify(await st())); }
    await page.screenshot({ path: `shots/pool-after-shot${n}.png` });
  }
} catch (e) { log("B exception", String(e && e.message).slice(0, 300)); }
log("ERRORS", errors.length, JSON.stringify(errors.slice(0, 6)));
await browser.close(); server.kill();
