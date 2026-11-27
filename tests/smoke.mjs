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
import { splitKnownMissing } from "./known-missing.mjs";
const results = [];
for (const sc of scenarios.filter((x) => !ONLY.length || ONLY.includes(x.name))) {
  const ctx = await browser.newContext({ viewport: sc.game === "brawlbots" ? { width: 860, height: 412 } : { width: 412, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => { errors.push("pageerror: " + e.message); console.log("PAGEERROR_STACK " + String(e.stack || "").split("\n").slice(0, 6).join(" | ").slice(0, 700)); });
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
    await page.addInitScript(() => { window.__DEBUG_HOTSEAT__ = true; });
    await page.addInitScript(() => { window.AndroidHost = { vibrate() {}, setOrientation(m) { (window.__ORI_HOST__ = window.__ORI_HOST__ || []).push(m); } }; });
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
    res.orientation = await page.evaluate(() => ({ viewport: innerWidth + "x" + innerHeight, canvas: (() => { const c = document.getElementById("game-canvas"); return c ? c.width + "x" + c.height : null; })(), hostCalls: window.__ORI_HOST__ || null }));
    res.orientation.ok = sc.game === "brawlbots" ? (res.orientation.hostCalls || []).slice(-1)[0] === "landscape" : (res.orientation.hostCalls || []).slice(-1)[0] === "portrait";
    // Pass-the-phone cover (REAL controls): visible at start for hidden-info games, never for Pool.
    const coverVisible = async () => (await page.locator("#pass-cover").isVisible());
    res.cover = { expected: sc.game !== "pool" && sc.game !== "monsters", atStart: await coverVisible() };
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
      await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); window.__deser = []; const o = l.deserialize.bind(l); l.deserialize = (...a) => { window.__deser.push({ t: Math.round(performance.now()), seatArg: a[1], coverVisible: !document.getElementById("pass-cover").classList.contains("hidden"), prevSeat: l._localSeat }); return o(...a); }; });
      res.lockin = { nSeats, start: await st(), picks: [], shots: [] };
      for (let k = 0; k < nSeats; k++) {
        const p = await pick();
        await page.waitForTimeout(3000);
        const after = await st();
        res.lockin.picks.push({ seat: p.seat, ok: p.ok, after });
        if (after.cover) await page.click("#pass-cover-btn");
      }
      // Shot lock-in: for each seat, try aimed impulses through localMove until the server accepts one
      // (accepted = the seat stays ready after a short wait; a rejected shot is reset by the server resync).
      res.lockin.validators = await page.evaluate(() => {
        const l = window.__ACTIVE_SESSION__.getClientLogic(); const out = { statics: {}, fns: {}, settings: {} };
        for (let c = l.constructor; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) for (const n of Object.getOwnPropertyNames(c)) if (/Wp|Weapon|Impulse|Flavour/i.test(n) && typeof c[n] === "function") out.statics[n] = String(c[n]).replace(/\s+/g, " ").slice(0, 900);
        for (const n of ["getShotWeapon", "canSelectWeapon", "getShotOrder", "isTankOwned"]) if (typeof l[n] === "function") out.fns[n] = String(l[n]).replace(/\s+/g, " ").slice(0, 600);
        for (const n of ["settings", "_settings", "matchConfig", "rules", "gsMgr"]) { try { if (l[n] !== undefined) out.settings[n] = JSON.stringify(l[n])?.slice(0, 400); } catch (e) { out.settings[n] = "err"; } }
        try { const w = l.worldMap.tanks[l._localSeat]; out.tank = { pos: JSON.stringify(w.position), angle: w.angle }; } catch (e) {}
        return out;
      });
      await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); window.__mv = []; const om = l.move.bind(l); l.move = (seat, packet, reveal) => { try { window.__mv.push({ t: Math.round(performance.now()), kind: "move", seat, a: packet && packet.m && packet.m.a, hasI: !!(packet && packet.i) }); } catch (e) {} return om(seat, packet, reveal); }; });
      // One legal shot per seat (impulse length 3 is below the validator limit; seats follow the automatic handoff).
      res.lockin.shotLog = [];
      for (let k = 0; k < nSeats; k++) {
        const t0w = Date.now(); const canShootWait = await page.waitForFunction(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); try { return !!l.canShoot(l._localSeat, true); } catch (e) { return false; } }, null, { timeout: 90000, polling: 500 }).then(() => true, () => false); const waitedMs = Date.now() - t0w;
        const r = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const seat = l._localSeat; const allowed = l.canSelectWeapon(seat, 0); const ok = allowed ? l.localMove({ a: 5, i: [2.476, 1.694], p: 0, f: 0, u: false }, false) : false; return { seat, allowed, ok, readyLocal: l.isShotReady(seat) }; });
        await page.waitForTimeout(2500);
        const after = await st();
        res.lockin.shotLog.push({ k, canShootWait, waitedMs, ...r, after, moves: await page.evaluate(() => window.__mv.slice(-4)) });
        if (after.cover) await page.click("#pass-cover-btn");
      }
      // Wait for the round to resolve: shots animate (paused true) then the next round starts (paused false).
      let sawPaused = false; res.lockin.roundStates = [];
      for (let w = 0; w < 24; w++) {
        await page.waitForTimeout(1500);
        const sn = await st(); if (sn.paused) sawPaused = true;
        res.lockin.roundStates.push(sn);
        if (sawPaused && !sn.paused) break;
      }
      res.lockin.sawPaused = sawPaused;
      res.lockin.afterRound = await st();
      res.lockin.afterRound.areShotsReady = await page.evaluate(() => { try { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { all: l.areShotsReady(), seat0Ready: l.isShotReady(0) }; } catch (e) { return String(e); } });
      await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1f-next-round.png` });
      res.lockin.srvLog = await page.evaluate(() => (window.__SRV_LOG || []).filter((e) => e.type !== "turnChanged").slice(-60));
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
      res.monstersReadySrc = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const o = {}; const seen = new Set(); let p = l; let depth = 0; while (p && p !== Object.prototype && depth < 6) { for (const n of Object.getOwnPropertyNames(p)) { if (seen.has(n) || n === "constructor") continue; seen.add(n); let d; try { d = Object.getOwnPropertyDescriptor(p, n); } catch (e) { continue; } if (!d || typeof d.value !== "function") continue; const src = String(d.value); if (/ready/i.test(n) || (/ready/i.test(src) && src.length < 700)) o[n] = src.replace(/\s+/g, " ").slice(0, 450); } p = Object.getPrototypeOf(p); depth++; } const keys = Object.keys(o); const out = {}; for (const kk of keys.slice(0, 22)) out[kk] = o[kk]; out.__count = keys.length; return out; });
      res.monstersReadyCallers = await page.evaluate(async () => { try { const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /\/game\/main\.js/.test(n)) || performance.getEntriesByType("resource").map((e) => e.name).find((n) => /main\.js/.test(n)); if (!u) return { err: "no main.js url" }; const txt = await (await fetch(u)).text(); const out = []; const re = /localReady\(|isSeatAwaitingReady\(|sendReady\(|__ready/g; let m; let last = -1000; while ((m = re.exec(txt)) && out.length < 16) { if (m.index - last < 300) continue; last = m.index; out.push(txt.slice(Math.max(0, m.index - 220), m.index + 260).replace(/\s+/g, " ")); } return { url: u.slice(-60), len: txt.length, out }; } catch (e) { return { err: String(e && e.message).slice(0, 100) }; } });
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
    if (sc.game === "monsters") {
      // INTERNAL API (labelled): drive the draft through the plugin's own move methods, then one legal board swap.
      const st2 = () => page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const p = l.plugins()[0]; return { phase: l.gamePhase, turn: JSON.stringify(l.turn), seat: l._localSeat, paused: l.paused, cover: !document.getElementById("pass-cover").classList.contains("hidden"), moveCount: l.moveCount, selecting: JSON.stringify(p && p.selecting), confirmed: JSON.stringify(p && p.confirmed), hud: document.getElementById("turn-text").textContent.trim() }; });
      res.draft = { steps: [], settings: await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const o = {}; for (const n of ["settings", "_settings", "matchRules", "gameMode", "firstSeat", "chosenStage", "liveMode", "weeklyStatus", "maxTurnMoves", "moveCountMax", "maxFreeMoves"]) { try { if (l[n] !== undefined) o[n] = JSON.stringify(l[n])?.slice(0, 200); } catch (e) {} } return o; }) };
      for (let round = 0; round < 4; round++) {
        const before = await st2();
        if (before.phase !== 0) break;
        const r = await page.evaluate(() => {
          const l = window.__ACTIVE_SESSION__.getClientLogic(); const p = l.plugins()[0]; const seat = l._localSeat; const out = { seat, picks: [], err: null };
          try {
            for (let n = 0; n < 8 && !p.canConfirm(seat); n++) {
              const idx = p.selectable.findIndex((m, ix) => m.sku !== 0 && p.canSelect(seat, m.key) && !p.selecting[seat].some((x) => x && x.key === m.key) && !p.confirmed[seat].some((x) => x && x.key === m.key));
              if (idx < 0) break;
              out.picks.push([p.selectable[idx].key, p.moveSelect(p.selectable[idx], p.selecting[seat].length + p.confirmed[seat].length)]);
            }
            out.canConfirm = p.canConfirm(seat);
            if (out.canConfirm) out.confirmOk = p.moveConfirm();
          } catch (e) { out.err = String(e && e.message).slice(0, 200); }
          return out;
        });
        await page.waitForTimeout(3500);
        const after = await st2();
        res.draft.steps.push({ before, r, after });
        if (after.cover) await page.click("#pass-cover-btn");
      }
      await page.waitForTimeout(4000);
      res.draft.final = await st2();
      await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1d-after-draft.png` });
      for (let w = 0; w < 14 && res.draft.final.phase !== 3; w++) { if (await page.locator("#pass-cover").isVisible()) await page.click("#pass-cover-btn"); await page.waitForTimeout(1500); res.draft.final = await st2(); }
      res.draft.reachedCombat = res.draft.final.phase === 3;
      if (res.draft.final.phase === 3) {
        // REAL TOUCH: dismiss the in-canvas tutorial popup ("OK" button, found from the after-draft screenshot) before touching the board.
        res.draft.realTouch = { okTap: [206, 722] };
        res.draft.realTouch.beforeOk = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { phase: l.gamePhase, seat: l._localSeat, moves: l.moveCount, board: l.board ? [l.board.width, l.board.height] : null }; });
        const crypto = await import("node:crypto");
        const region = async () => crypto.createHash("md5").update(await page.screenshot({ clip: { x: 60, y: 230, width: 290, height: 50 } })).digest("hex");
        const cdp = await ctx.newCDPSession(page);
        res.draft.realTouch.variants = [];
        const h0 = await region();
        const variants = [
          ...(process.env.TAPSCAN ? [40,80,110,130,138,150,170,200,250,300,340].map((yy) => ["scan-y" + yy, async () => { await page.touchscreen.tap(206, yy); }]) : []),
          ["cdp-touch-100ms", async () => { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y: 722 }] }); await page.waitForTimeout(100); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }],
          ["mouse-100ms-move", async () => { await page.mouse.move(206, 722); await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.move(207, 722); await page.waitForTimeout(50); await page.mouse.up(); }],
          ["tap-y700", async () => { await page.touchscreen.tap(206, 700); }],
          ["tap-y740", async () => { await page.touchscreen.tap(206, 740); }],
          ["tap-x120", async () => { await page.touchscreen.tap(120, 722); }],
        ];
        for (const [name, fn] of variants) {
          await fn(); await page.waitForTimeout(1500);
          const h = await region(); const changed = h !== h0;
          res.draft.realTouch.variants.push({ name, changed });
          await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1d2-${name}.png` });
          if (changed) break;
        }
        await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1d2-after-ok-tap.png` });
        res.draft.geo = await page.evaluate(() => {
          const l = window.__ACTIVE_SESSION__.getClientLogic(); const o = { canvas: null };
          const c = document.getElementById("game-canvas"); const r = c.getBoundingClientRect(); o.canvas = { x: r.x, y: r.y, w: r.width, h: r.height, cw: c.width, ch: c.height, dpr: window.devicePixelRatio };
          const seen = new Set(); const hits = [];
          const walk = (v, path, depth) => { if (!v || typeof v !== "object" || seen.has(v) || depth > 4 || hits.length > 12) return; seen.add(v); let keys = []; try { keys = Object.keys(v); } catch (e) { return; } if (keys.includes("boardNode") || (typeof v.getTilePos === "function")) hits.push({ path, keys: keys.slice(0, 25) }); for (const k of keys.slice(0, 60)) { let x; try { x = v[k]; } catch (e) { continue; } if (x && typeof x === "object") walk(x, path + "." + k, depth + 1); } };
          walk(l, "logic", 0); try { walk(l.sceneMgr, "sceneMgr", 0); } catch (e) {} try { walk(window.__ACTIVE_SESSION__, "session", 0); } catch (e) {}
          o.hits = hits; o.sceneKeys = (() => { try { return Object.keys(l.sceneMgr || {}).slice(0, 40); } catch (e) { return null; } })();
          o.globals = Object.keys(window).filter((k) => /^__|scene|game|stage|node|pixi/i.test(k)).slice(0, 40);
          return o;
        });
        const mv = await page.evaluate(() => {
          const l = window.__ACTIVE_SESSION__.getClientLogic(); const b = l.board; const seat = l._localSeat; const out = { seat };
          try {
            let found = null;
            for (let y = 0; y < b.height && !found; y++) for (let x = 0; x < b.width && !found; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
              const x2 = x + dx, y2 = y + dy; if (x2 >= b.width || y2 >= b.height || !b.areTilesAdjacent(x, y, x2, y2)) continue;
              b.swapTiles(x, y, x2, y2); const t = b.tiles[y2][x2]; const ms = b.getMatches(t); b.swapTiles(x2, y2, x, y);
              if (ms && ms.length) { found = { x1: x, y1: y, x2, y2 }; break; }
            }
            out.found = found;
            if (found) out.ok = l.localMove({ t: 6, ...found }, true);
          } catch (e) { out.err = String(e && e.message).slice(0, 200); }
          return out;
        });
        res.draft.swap = mv;
        res.draft.swapStates = [];
        await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); window.__LM = []; window.__WARN = []; if (!l.__lmWrapped) { l.__lmWrapped = true; window.__EV = []; const t0 = performance.now(); try { l.onSynchronize.receive(() => window.__EV.push([Math.round(performance.now() - t0), 'sync'])); l.onAction.receive((t) => window.__EV.push([Math.round(performance.now() - t0), 'act', t])); l.onMove.receive(() => window.__EV.push([Math.round(performance.now() - t0), 'move'])); l.onReady.receive(() => window.__EV.push([Math.round(performance.now() - t0), 'ready'])); } catch (e) { window.__EV.push(['err', String(e).slice(0, 80)]); } const o = l.localMove.bind(l); l.localMove = (m, e) => { const r = o(m, e); window.__LM.push({ m: JSON.stringify(m).slice(0, 60), e, seat: l._localSeat, paused: l._paused, r }); return r; }; const w = console.warn.bind(console); console.warn = (...a) => { window.__WARN.push(a.map(String).join(" ").slice(0, 160)); w(...a); }; } });
        res.draft.diagReady = { note: "DIAGNOSTIC ONLY, one call after 6s of an unacked ready check, not a fix" };
        const seatStart = res.draft.final.seat; res.draft.swaps = [mv];
        for (let w = 0; w < 75; w++) {
          await page.waitForTimeout(1500); const sn = await st2(); sn.aw = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); try { return { a: [0, 1].map((x) => l.isSeatAwaitingReady(x)), rs: Array.from(l._readySeats || []), alarm: l._alarmState, paused: l._paused }; } catch (e) { return String(e).slice(0, 80); } }); res.draft.swapStates.push(sn);
          if (w === 4) {
            res.draft.diagReady.before = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { phase: l.gamePhase, rs: Array.from(l._readySeats || []), seat: l._localSeat, paused: l._paused, active: l.isGameActive(), lm: window.__LM.slice(-10), warn: window.__WARN.slice(-5), ev: (window.__EV || []).slice(-40) }; });
            res.draft.diagReady.call = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const r = l.localReady(); return { r }; });
            await page.waitForTimeout(1500);
            res.draft.diagReady.after = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { phase: l.gamePhase, rs: Array.from(l._readySeats || []), seat: l._localSeat, lm: window.__LM.slice(-4), warn: window.__WARN.slice(-5) }; });
          }
          if (sn.cover) { res.draft.seatChangedWithCover = { from: seatStart, to: sn.seat, phase: sn.phase, paused: sn.paused }; break; }
          if (!sn.paused && sn.phase === 3 && sn.seat === seatStart && res.draft.swaps.length < 6) {
            const mv2 = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); const b = l.board; const out = { seat: l._localSeat }; try { let found = null; for (let y = 0; y < b.height && !found; y++) for (let x = 0; x < b.width && !found; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) { const x2 = x + dx, y2 = y + dy; if (x2 >= b.width || y2 >= b.height || !b.areTilesAdjacent(x, y, x2, y2)) continue; b.swapTiles(x, y, x2, y2); const t = b.tiles[y2][x2]; const ms = b.getMatches(t); b.swapTiles(x2, y2, x, y); if (ms && ms.length) { found = { x1: x, y1: y, x2, y2 }; break; } } out.found = found; if (found) out.ok = l.localMove({ t: 6, ...found }, true); } catch (e) { out.err = String(e && e.message).slice(0, 160); } return out; });
            res.draft.swaps.push(mv2);
          }
        }
        res.draft.srvLog = await page.evaluate(() => (window.__SRV_LOG || []).filter((e) => e.type !== "turnChanged").slice(-40));
        await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1e-after-swap.png` });
      }
    }
    if (sc.game === "monsters") res.monstersAfter = await page.evaluate(() => { const l = window.__ACTIVE_SESSION__.getClientLogic(); return { phase: l.gamePhase, turn: JSON.stringify(l.turn), seat: l._localSeat, moves: l.moveCount, paused: l.paused }; });
    res.steps.hud2 = (await page.textContent("#turn-text"))?.trim();
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-2-after-input.png` });
    // Brawlbots hotseat re-shows the pass-cover on every seat-change HUD update (by design), which can
    // race the menu click: dismiss robustly and retry the menu click while the cover keeps re-appearing.
    let menuOpened = false;
    for (let i = 0; i < 5 && !menuOpened; i++) {
      if (await page.locator("#pass-cover").isVisible()) await page.click("#pass-cover-btn", { timeout: 3000 }).catch(() => {});
      try { await page.click("#menu-btn", { timeout: 6000 }); menuOpened = true; } catch (e) { if (i === 4) throw e; }
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-3-menu.png` });
    await page.click("#menu-rematch-btn");
    await page.waitForTimeout(6000);
    res.steps.hud3 = (await page.textContent("#turn-text"))?.trim();
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-4-after-rematch.png` });
    res.steps.rematchClicked = true;
  } catch (e) {
    errors.push("test-exception: " + String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400));
  }
  { const sp = splitKnownMissing(errors, failedUrls); res.knownMissing404Console = sp.knownMissing404Console; res.errors = sp.errors.slice(0, 15); }
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
const bad = results.filter((r) => r.errors.length || r.cover?.ok === false || r.orientation?.ok === false || r.externalRequests.length || !r.steps.rematchClicked);
if (bad.length) { console.log("FAILED: " + bad.map((b) => b.name).join(", ")); process.exit(1); }
