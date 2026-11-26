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
  const res = { game, steps: {}, errors };
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(name + " pageerror: " + e.message.slice(0, 140)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(name + " console: " + m.text().slice(0, 140)); });
    page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") errors.push(name + " worker: " + m.text().slice(0, 140)); }));
    page.on("dialog", async (d) => { errors.push(name + " dialog: " + d.message().slice(0, 100)); await d.dismiss(); });
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
    await A.ctx.close(); await B.ctx.close();
  } catch (e) { res.steps.exception = String(e && e.message).slice(0, 300); }
  out.push(res);
}
await browser.close(); server.kill();
const txt = JSON.stringify(out, null, 1);
console.log("LAN_MATCH_RESULTS " + txt);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## LAN match test (relay stand-in, two contexts, internal-API actions)\n```json\n" + txt + "\n```\n");
const bad = out.filter((r) => r.steps.exception || !r.steps.seats || !r.steps.sameState || r.steps.movesAdvanced === false);
if (bad.length) { console.log("FAILED LAN match for: " + bad.map((r) => r.game).join(",")); process.exit(1); }
