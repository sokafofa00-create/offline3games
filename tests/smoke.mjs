// Headless smoke test: load each game through the real web UI, start a match, poke the canvas,
// open the menu, trigger rematch. This is a LOAD/START smoke test, not full gameplay coverage.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 8090;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const SHOT_DIR = process.env.SHOT_DIR || "shots";
const ONLY = (process.env.SCEN || "").split(",").filter(Boolean);
const BACKEND = process.env.BACKEND || "swiftshader";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const scenarios = [
  { name: "pool-8ball", game: "pool" },
  { name: "pool-cutthroat-3p", game: "pool", set: { "#pool-gametype": "6" } },
  { name: "monsters-normal", game: "monsters" },
  { name: "monsters-freemoves", game: "monsters", set: { "#mm-rules": "1" } },
  { name: "brawlbots-2p", game: "brawlbots" },
  { name: "brawlbots-3p", game: "brawlbots", set: { "#bb-players": "1" } },
  { name: "brawlbots-4p", game: "brawlbots", set: { "#bb-players": "2" } },
];

const browser = await chromium.launch(
  BACKEND === "gl"
    ? { headless: false, args: ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] }
    : { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] },
);
const results = [];
for (const sc of scenarios.filter((x) => !ONLY.length || ONLY.includes(x.name))) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const warnLines = [];
  page.on("console", (m) => { if (m.type() === "warning" && /Missing preloaded|\[GL\]|WebGL/i.test(m.text())) warnLines.push(m.text().slice(0, 160)); });
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") errors.push("worker-console: " + m.text()); }));
  page.on("request", (r) => { if (!r.url().startsWith(`http://localhost:${PORT}/`) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) requests.push(r.url()); });
  page.on("dialog", async (d) => { errors.push("dialog: " + d.message()); await d.dismiss(); });
  const failedUrls = [];
  page.on("response", (r) => { if (r.status() >= 400) failedUrls.push(r.status() + " " + r.url().replace(`http://localhost:${PORT}`, "")); });
  const res = { name: sc.name, backend: BACKEND, steps: {} };
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.click(`.game-tab[data-game="${sc.game}"]`);
    for (const [sel, val] of Object.entries(sc.set || {})) await page.selectOption(sel, val);
    await page.click("#start-btn");
    await page.waitForSelector("#game-screen.active", { timeout: 60000 });
    await page.waitForFunction(() => !!window.__ACTIVE_SESSION__, null, { timeout: 90000 });
    await page.waitForTimeout(6000);
    res.steps.started = true;
    res.logic = await page.evaluate(() => {
      const lg = window.__ACTIVE_SESSION__?.getClientLogic?.();
      if (!lg) return { error: "no client logic" };
      const names = new Set();
      for (let o = lg; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) Object.getOwnPropertyNames(o).forEach((n) => names.add(n));
      const all = [...names];
      const pick = (re) => all.filter((n) => re.test(n)).slice(0, 60);
      const val = (k) => { try { const v = lg[k]; return typeof v === "function" ? "fn" : JSON.stringify(v)?.slice(0, 80); } catch (e) { return "err"; } };
      return {
        state: Object.fromEntries(["turn", "gamePhase", "_localSeat", "localSeat", "paused", "started", "gameOver", "vMode", "numSeats", "displaySeat"].map((k) => [k, val(k)])),
        board: (() => { try { const b = lg.board; if (!b) return null; return { w: b.width, h: b.height, row0: JSON.stringify(b.tiles?.[0])?.slice(0, 200), nTiles: b.tiles?.length, ps: JSON.stringify(lg.playerStates)?.slice(0, 600), settings: JSON.stringify(lg.settings || lg._settings)?.slice(0, 300) }; } catch (e) { return String(e); } })(),
        props: Object.fromEntries(all.filter((n) => { try { return typeof lg[n] !== "function"; } catch (e) { return false; } }).slice(0, 90).map((n) => [n, val(n)])),
        src: Object.fromEntries(["localMove", "localReady", "_move", "move", "moveSwapTiles", "moveDeselectTile", "isTurn", "isResigned", "readyCheck", "isSeatAwaitingReady", "haveAllMovesBeenMade", "fire", "sendReady", "isShotReady", "areShotsReady", "canShoot", "canSelectTank", "shoot", "canMoveCueBall"].filter((n) => typeof lg[n] === "function").map((n) => [n, String(lg[n]).replace(/\s+/g, " ").slice(0, 1800)])),
        methods: pick(/ready|confirm|select|pick|lock|shoot|shots|fire|submit|choose|draft|forfeit|move|simult|reveal|hidden|visible/i),
      };
    });
    res.steps.hud1 = (await page.textContent("#turn-text"))?.trim();
    // Pass-the-phone cover (REAL controls): visible at start for hidden-info games, never for Pool.
    const coverVisible = async () => (await page.locator("#pass-cover").isVisible());
    res.cover = { expected: sc.game !== "pool", atStart: await coverVisible() };
    if (res.cover.atStart) {
      res.cover.title = (await page.textContent("#pass-cover-title"))?.trim();
      await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1b-cover.png` });
      await page.click("#pass-cover-btn");
      res.cover.hiddenAfterTap = !(await coverVisible());
    }
    res.cover.ok = res.cover.atStart === res.cover.expected && (!res.cover.expected || res.cover.hiddenAfterTap);
    if (sc.game === "brawlbots") res.switch = { buttonHidden: !(await page.locator("#switch-seat-btn").isVisible()) };
    if (sc.game === "brawlbots") {
      // INTERNAL API (labelled): select each seat's tank through localMove and record the automatic handoff.
      const st = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { turn: JSON.stringify(l.turn), seat: l._localSeat, paused: l.paused, cover: !document.getElementById("pass-cover").classList.contains("hidden"), hud: document.getElementById("turn-text").textContent.trim() }; });
      const pick = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const seat = l._localSeat; const own = []; for (let i = 0; i < 16; i++) { try { if (l.isTankOwned(seat, i)) own.push(i); } catch (e) {} } let ok = null; if (own.length) ok = l.localMove({ a: 1, t: own[0] }); return { seat, own, ok }; });
      const nSeats = await page.evaluate(() => window.__ACTIVE_SESSION__.getClientLogic()._seats);
      // Boundary check: record whether the cover is already visible whenever the next seat's state is loaded.
      await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); window.__deser = []; const o = l.deserialize.bind(l); l.deserialize = (...a) => { window.__deser.push({ seatArg: a[1], coverVisible: !document.getElementById("pass-cover").classList.contains("hidden"), prevSeat: l._localSeat }); return o(...a); }; });
      res.lockin = { nSeats, start: await st(), picks: [], shots: [] };
      for (let k = 0; k < nSeats; k++) {
        const p = await pick();
        await page.waitForTimeout(3000);
        const after = await st();
        res.lockin.picks.push({ seat: p.seat, ok: p.ok, after });
        if (after.cover) await page.click("#pass-cover-btn");
      }
      for (let k = 0; k < nSeats; k++) {
        const r = await page.evaluate(() => {
          const l = window.__ACTIVE_SESSION__.getClientLogic();
          const seat = l._localSeat;
          const out = { seat, canShoot: null, tankKeys: null, wp: null, err: null, ready: null };
          try {
            out.canShoot = l.canShoot(seat, true);
            const names = new Set();
            for (let o = l; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) Object.getOwnPropertyNames(o).forEach((x) => names.add(x));
            out.wpNames = [...names].filter((x) => /weap|wpn|wp[A-Z_]|ammo/i.test(x)).slice(0, 40);
            out.valid = [];
            for (let p = 0; p < 40; p++) { try { if (l.canSelectWeapon(seat, p)) out.valid.push(p); } catch (e) {} }
            out.src = String(l.canSelectWeapon).replace(/\s+/g, " ").slice(0, 400);
            out.wmKeys = Object.keys(l.worldMap).filter((x) => /weap|tank|shot|sel/i.test(x)).slice(0, 30);
            if (out.valid.length) {
              out.ok = l.localMove({ a: 5, i: [20, 6], p: out.valid[0], f: 0, u: false }, true);
            }
            out.ready = l.isShotReady(seat);
          } catch (e) { out.err = String(e && e.message).slice(0, 160); }
          return out;
        });
        await page.waitForTimeout(3500);
        const after = await st();
        res.lockin.shots.push({ ...r, after });
        if (after.cover) await page.click("#pass-cover-btn");
      }
      res.lockin.deserializeBoundary = await page.evaluate(() => window.__deser);
      await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1c-after-picks.png` });
    }
    if (sc.game !== "pool") {
      // REAL control: while the cover is up, a tap on the canvas must not reach the game.
      await page.evaluate(() => { window.__tapCount = 0; document.getElementById("game-canvas").addEventListener("pointerdown", () => window.__tapCount++); });
      if (!(await coverVisible())) { await page.evaluate(() => { const b = document.getElementById("pass-cover"); b.classList.remove("hidden"); }); }
      const bx = await page.locator("#game-canvas").boundingBox();
      await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
      res.coverBlocksInput = { canvasPointerDowns: await page.evaluate(() => window.__tapCount) };
      await page.click("#pass-cover-btn");
    }
    if (sc.game === "monsters") {
      const snap = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { phase: l.gamePhase, turn: JSON.stringify(l.turn), seat: l._localSeat, moves: l.moveCount, paused: l.paused }; });
      res.monstersBefore = await snap();
      res.monstersPlugins = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); try { return l.plugins().map((p) => ({ name: p.constructor && p.constructor.name, keys: Object.keys(p).slice(0, 25), moveVal: undefined, proto: Object.getOwnPropertyNames(Object.getPrototypeOf(p)).slice(0, 30), state: { selecting: JSON.stringify(p.selecting)?.slice(0, 200), confirmed: JSON.stringify(p.confirmed)?.slice(0, 120), mode: p.mode, selectable: JSON.stringify(p.selectable)?.slice(0, 200), complete: p.complete }, fns: Object.fromEntries(["validSelect", "validConfirm", "moveSelect", "moveConfirm", "control_seat", "local_control", "local_confirm", "select", "validSwap", "moveSwap"].filter((n) => { try { return typeof p[n] === "function"; } catch (e) { return false; } }).map((n) => [n, String(p[n]).replace(/\s+/g, " ").slice(0, 700)])) })); } catch (e) { return String(e); } });
      res.monstersPhaseSrc = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const o = {}; for (const n of ["onMove", "startReadyCheck", "turnExpireWaitingForBattleReady", "_ready", "turnExpireBattlePrep"]) if (typeof l[n] === "function") o[n] = String(l[n]).replace(/\s+/g, " ").slice(0, 700); return o; });
    }
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1-start.png` });
    const box = await page.locator("#game-canvas").boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 6 });
      await page.mouse.up();
    }
    await page.waitForTimeout(3000);
    if (sc.game === "monsters") res.monstersAfter = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { phase: l.gamePhase, turn: JSON.stringify(l.turn), seat: l._localSeat, moves: l.moveCount, paused: l.paused }; });
    res.steps.hud2 = (await page.textContent("#turn-text"))?.trim();
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-2-after-input.png` });
    if (await page.locator("#pass-cover").isVisible()) await page.click("#pass-cover-btn");
    await page.click("#menu-btn");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-3-menu.png` });
    await page.click("#menu-rematch-btn");
    await page.waitForTimeout(6000);
    res.steps.hud3 = (await page.textContent("#turn-text"))?.trim();
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-4-after-rematch.png` });
    res.steps.rematchClicked = true;
  } catch (e) {
    errors.push("test-exception: " + String(e.message).split("\n")[0]);
  }
  res.errors = errors.slice(0, 15);
  res.externalRequests = requests;
  res.glWarnings = [...new Set(warnLines)].slice(0, 25);
  res.failedUrls = [...new Set(failedUrls)].slice(0, 20);
  results.push(res);
  await ctx.close();
}
await browser.close();
server.kill();
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Smoke results\n```json\n" + JSON.stringify(results, (k, v) => (k === "props" || k === "methods" || k === "src" || k === "tankKeys") ? undefined : v, 1).slice(0, 200000) + "\n```\n");
console.log("SMOKE_RESULTS " + JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.errors.length || r.cover?.ok === false || r.externalRequests.length || !r.steps.rematchClicked);
if (bad.length) { console.log("FAILED: " + bad.map((b) => b.name).join(", ")); process.exit(1); }
