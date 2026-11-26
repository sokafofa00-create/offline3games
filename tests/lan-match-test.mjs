// Two-phone LAN match test: two browser contexts, lobby -> match card -> join -> both sessions start with one seat each,
// then one internal-API action per seat must show up on BOTH clients. Uses the dev /__lan relay in place of the native transport.
// Classification: internal-API actions through the relay. NOT real touch control, NOT real Wi-Fi.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8093;
const GAMES = (process.env.LAN_GAMES || "pool,monsters,brawlbots").split(",");
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const out = [];
const snap = (page) => page.evaluate(() => { const l = window.__ACTIVE_SESSION__?.getClientLogic?.(); if (!l) return null; return { seat: l._localSeat, turn: JSON.stringify(l.turn), phase: l.gamePhase, sel: (() => { try { return !!l.worldMap.tanksSelected(true); } catch (e) { return null; } })(), over: !!l.gameOver, names: window.__LAN_PARAMS__ }; });
for (const game of GAMES) {
  const vp = game === "brawlbots" ? { width: 860, height: 412 } : { width: 412, height: 860 };
  const errors = [];
  const dialogs = [];
  const res = { game, steps: {}, errors, dialogs };
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(name + " pageerror: " + e.message.slice(0, 140)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(name + " console: " + m.text().slice(0, 140)); });
    page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") errors.push(name + " worker: " + m.text().slice(0, 140)); }));
    page.on("dialog", async (d) => { dialogs.push(name + ": " + d.message().slice(0, 100)); await d.dismiss(); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.fill("#p1-name", name);
    await page.click('.mode-tab[data-mode="lan"]');
    return { ctx, page };
  };
  try {
    const A = await mk("Host"); const B = await mk("Guest");
    await A.page.waitForFunction(() => document.querySelectorAll("#lobby-players .peer-chip").length === 1, null, { timeout: 15000 });
    await B.page.waitForFunction(() => document.querySelectorAll("#lobby-players .peer-chip").length === 1, null, { timeout: 15000 });
    await A.page.click("#lobby-games-btn");
    await A.page.click(`#lobby-games-menu [data-lobby-game="${game}"]`);
    await B.page.waitForSelector("#lobby-chat .join-btn", { timeout: 10000 });
    await A.page.setViewportSize(vp); await B.page.setViewportSize(vp);
    await B.page.click("#lobby-chat .join-btn");
    for (const P of [A, B]) await P.page.waitForFunction(() => !!window.__ACTIVE_SESSION__?.getClientLogic?.(), null, { timeout: 120000 });
    await A.page.waitForTimeout(10000);
    res.start = { A: await snap(A.page), B: await snap(B.page) };
    res.steps.seats = res.start.A?.seat === 0 && res.start.B?.seat === 1;
    res.steps.noCover = !(await A.page.locator("#pass-cover").isVisible()) && !(await B.page.locator("#pass-cover").isVisible());
    // one internal-API action per seat
    const act = (page, seat) => page.evaluate(({ game, seat }) => {
      const l = window.__ACTIVE_SESSION__.getClientLogic(); const o = { seat };
      try {
        if (game === "brawlbots") { const own = []; for (let i = 0; i < 16; i++) { try { if (l.isTankOwned(seat, i)) own.push(i); } catch (e) {} } if (l.canSelectTank(seat, 0)) o.pick = l.localMove({ a: 1, t: own[0] }); }
        else if (game === "monsters") { const p = l.plugins()[0]; for (let n = 0; n < 8 && !p.canConfirm(seat); n++) { const idx = p.selectable.findIndex((m) => m.sku !== 0 && p.canSelect(seat, m.key) && !p.selecting[seat].some((x) => x && x.key === m.key) && !p.confirmed[seat].some((x) => x && x.key === m.key)); if (idx < 0) break; p.moveSelect(p.selectable[idx], p.selecting[seat].length + p.confirmed[seat].length); } if (p.canConfirm(seat)) o.confirm = p.moveConfirm(); }
        else { o.turn = JSON.stringify(l.turn); }
      } catch (e) { o.err = String(e && e.message).slice(0, 120); }
      return o;
    }, { game, seat });
    res.actions = [];
    if (game !== "pool") {
      res.actions.push(await act(A.page, 0)); await A.page.waitForTimeout(5000);
      res.mid = { A: await snap(A.page), B: await snap(B.page) };
      res.actions.push(await act(B.page, 1)); await A.page.waitForTimeout(8000);
    }
    res.end = { A: await snap(A.page), B: await snap(B.page) };
    res.steps.sameState = !!res.end.A && !!res.end.B && res.end.A.turn === res.end.B.turn && res.end.A.phase === res.end.B.phase && res.end.A.sel === res.end.B.sel;
    const chg = (x, y) => x.turn !== y.turn || x.sel !== y.sel || x.phase !== y.phase;
    res.steps.movesAdvanced = game === "pool" ? null : (chg(res.end.A, res.start.A) && chg(res.end.B, res.start.B));
    await A.page.screenshot({ path: `shots/lan-${game}-host.png` });
    await B.page.screenshot({ path: `shots/lan-${game}-guest.png` });
    if (game === "pool") {
      // Turn ownership per seat (user report: on the other player's turn this phone could still move the cue).
      const crypto = await import("node:crypto");
      const caps = (page) => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const o = { turn: JSON.stringify(l.turn), seat: l._localSeat, paused: l.paused }; for (const s of [0, 1]) { try { o["canShoot" + s] = !!l.canShoot(s); } catch (e) { o["canShoot" + s] = "err"; } } return o; });
      const rot = (page) => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const c = l.sceneMgr && l.sceneMgr.cueStick; return c ? { r: c.rotation, en: !!(l.sceneMgr.powerMeter && l.sceneMgr.powerMeter.enabled !== undefined ? l.sceneMgr.powerMeter.enabled : null), loc: !!l.isLocalPlayerTurn(), ls: l.localSeat, t: JSON.stringify(l.turn), it0: !!l.isTurn(0), it1: !!l.isTurn(1), itl: !!l.isTurn(l.localSeat), lt: !!l.localTurn, cls: l.constructor && l.constructor.name } : null; });
      const hash = async (page) => crypto.createHash("md5").update(await page.screenshot({ clip: { x: 20, y: 260, width: 372, height: 480 } })).digest("hex");
      const drag = async (page) => { await page.mouse.move(206, 640); await page.mouse.down(); await page.mouse.move(300, 600, { steps: 8 }); await page.mouse.move(120, 560, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1200); };
      const probe = async (label) => {
        const o = { label, A: await caps(A.page), B: await caps(B.page) };
        const ha0 = await hash(A.page); await A.page.waitForTimeout(800); const ha1 = await hash(A.page);
        const hb0 = await hash(B.page); await B.page.waitForTimeout(800); const hb1 = await hash(B.page);
        o.idleStable = ha0 === ha1 && hb0 === hb1;
        o.hostRot0 = await rot(A.page); await drag(A.page); o.hostRot1 = await rot(A.page); o.hostStickMoved = (await hash(A.page)) !== ha1;
        await A.page.waitForTimeout(1500);
        const hb2 = await hash(B.page); await B.page.waitForTimeout(800); const hb3 = await hash(B.page); o.guestStableBeforeDrag = hb2 === hb3;
        o.guestRot0 = await rot(B.page); await drag(B.page); o.guestRot1 = await rot(B.page); o.guestStickMoved = (await hash(B.page)) !== hb3;
        return o;
      };
      res.poolTurns = [];
      res.poolTurns.push(await probe("start"));
      { const ownerIsHost = res.poolTurns[0].A.canShoot0 === true; const shooter = ownerIsHost ? A : B; const sseat = ownerIsHost ? 0 : 1;
      res.poolTurns[0].shot = await shooter.page.evaluate((sseat) => { const l = window.__ACTIVE_SESSION__.getClientLogic(); try { if (!l.canShoot(sseat)) return { skip: true }; if (l.canMoveCueBall && l.canMoveCueBall(sseat)) l.requestCueBallMove([l.table.cueBall.position[0], l.table.cueBall.position[1]]); l.requestShot(0.9, -1.5, [0, 0]); return { shot: true, sseat }; } catch (e) { return { err: String(e && e.message).slice(0, 100) }; } }, sseat); }
      for (let k = 0; k < 40; k++) { await A.page.waitForTimeout(1000); const c = await caps(A.page); if (c.turn !== res.poolTurns[0].A.turn && !c.paused) break; }
      await A.page.waitForTimeout(2500);
      res.poolTurns.push(await probe("after-guest-shot"));
      const t = res.poolTurns;
      res.poolOwnerSeats = t.map((x) => { try { return JSON.parse(x.A.turn)[0]; } catch (e) { return null; } });
      res.steps.poolOwnership = t.every((x, k) => x.idleStable && (res.poolOwnerSeats[k] === 0 ? (x.hostStickMoved === true && x.guestStickMoved === false) : res.poolOwnerSeats[k] === 1 ? (x.hostStickMoved === false && x.guestStickMoved === true) : false));
    }
    if (game === "pool") {
      // Connection loss: the guest phone vanishes (context closed). The host must notice, tell the player and return to the menu.
      await B.ctx.close();
      try { await A.page.waitForSelector("#setup-screen.active", { timeout: 40000 }); res.steps.disconnect = dialogs.some((d) => d.startsWith("Host:") && d.includes("انقطع")); } catch (e) { res.steps.disconnect = false; }
      await A.ctx.close();
    } else { await A.ctx.close(); await B.ctx.close(); }
  } catch (e) { res.steps.exception = String(e && e.message).slice(0, 300); }
  out.push(res);
}
await browser.close(); server.kill();
const txt = JSON.stringify(out, null, 1);
console.log("LAN_MATCH_RESULTS " + txt);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## LAN match test (relay stand-in, two contexts, internal-API actions)\n```json\n" + txt + "\n```\n");
const bad = out.filter((r) => r.steps.exception || !r.steps.seats || !r.steps.sameState || r.steps.movesAdvanced === false || r.steps.disconnect === false || r.steps.poolOwnership === false);
if (bad.length) { console.log("FAILED LAN match for: " + bad.map((r) => r.game).join(",")); process.exit(1); }
