// Pool same-device (hotseat) turn hand-over: after each shot ends, the active seat must follow the game's turn right away.
// Internal-API shots. NOT real touch.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8095;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 140)); });
const res = { shots: [], errors };
const snap = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const hud = document.getElementById("turn-text")?.textContent || ""; return { turn: JSON.stringify(l.turn), seat: l._localSeat, paused: !!l.paused, over: !!l.gameOver, hud, bi: (() => { try { return l.ballInHand; } catch (e) { return null; } })(), balls: l.table.balls.map((b) => (b.isPocketed() ? "P" : b.position.map((v) => Math.round(v)).join(","))).join("|"), cue: l.table.cueBall.position.map((v) => Math.round(v)).join(",") }; });
try {
  await page.addInitScript(() => { window.AndroidHost = { vibrate() {}, setOrientation() {} }; });
  await page.goto(`http://localhost:${PORT}/`);
  await page.click("#start-btn");
  await page.waitForSelector("#game-screen.active", { timeout: 60000 });
  await page.waitForFunction(() => !!window.__ACTIVE_SESSION__?.getClientLogic?.()?.table, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  res.start = await snap();
  for (let n = 0; n < 8; n++) {
    let s = await snap();
    if (s.over) break;
    const seatBefore = s.seat, turnBefore = s.turn;
    const r = await page.evaluate((n) => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const seat = l.turn[0]; try { if (!l.canShoot(l._localSeat)) return { skip: true, localCanShoot: false }; if (l.canMoveCueBall && l.canMoveCueBall(l._localSeat)) { l.requestCueBallMove([l.table.cueBall.position[0], l.table.cueBall.position[1]]); } const nb = l.table.balls.filter((b) => !b.isPocketed())[0]; const c = l.table.cueBall.position; const ang = n % 2 ? -1.5 : Math.atan2(nb.position[1] - c[1], nb.position[0] - c[0]); l.requestShot(0.5 + 0.05 * n, ang, [0, 0]); return { shot: true, as: l._localSeat }; } catch (e) { return { err: String(e && e.message).slice(0, 100) }; } }, n);
    // wait for the shot to finish: balls move, then stop and the game is not paused
    const t0 = Date.now(); let moved = false, lastBalls = s.balls, still = 0, tSettled = null, tSync = null, last = s;
    while (Date.now() - t0 < 60000) {
      await page.waitForTimeout(250); last = await snap();
      if (last.balls !== lastBalls) { moved = true; still = 0; lastBalls = last.balls; } else if (moved) still++;
      if (moved && still >= 4 && !last.paused && tSettled === null) tSettled = Date.now();
      if (tSettled !== null && last.turn !== turnBefore && last.seat === JSON.parse(last.turn)[0] && tSync === null) { tSync = Date.now(); break; }
      if (tSettled !== null && Date.now() - tSettled > 8000) break;
      if (!r.shot && Date.now() - t0 > 6000) break;
    }
    res.shots.push({ n, seatBefore, turnBefore, r, moved, turnAfter: last.turn, seatAfter: last.seat, hudAfter: last.hud, paused: last.paused, secsSettleToSync: tSettled && tSync ? Math.round((tSync - tSettled) / 100) / 10 : null, turnChanged: last.turn !== turnBefore, seatFollowsTurn: last.seat === JSON.parse(last.turn)[0] });
    if (r.skip) break;
  }
} catch (e) { res.exception = String(e && e.message).slice(0, 300); }
await page.screenshot({ path: "shots/pool-hotseat-end.png" }).catch(() => {});
await browser.close(); server.kill();
const out = JSON.stringify(res, null, 1);
console.log("POOL_HOTSEAT_RESULTS " + out.length);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Pool hotseat turns\n```json\n" + out + "\n```\n");
console.log(out);
const bad = res.exception || res.shots.length < 3 || res.shots.some((x) => x.r.shot && !x.seatFollowsTurn) || res.shots.some((x) => x.r.skip || x.r.err);
if (bad) { console.log("FAILED pool hotseat turns"); process.exit(1); }
