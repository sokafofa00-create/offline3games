// REAL-CONTROL end-of-match test: menu -> resign item -> confirm -> game over bar -> rematch button -> fresh match.
// Uses DOM clicks only (the logic object is read for assertions, never driven).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const PORT = 8092;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const scenarios = [
  { name: "pool-8ball", game: "pool" },
  { name: "pool-cutthroat-3p", game: "pool", set: { "#pool-gametype": "6" } },
  { name: "monsters-normal", game: "monsters" },
  { name: "brawlbots-2p", game: "brawlbots" },
  { name: "brawlbots-4p", game: "brawlbots", set: { "#bb-players": "2" } },
];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const out = [];
const snap = (page) => page.evaluate(() => { const l = window.__ACTIVE_SESSION__?.getClientLogic?.(); const bar = document.getElementById("gameover-bar"); return { logic: !!l, gameOver: l ? !!l.gameOver : null, turn: l ? JSON.stringify(l.turn) : null, phase: l ? l.gamePhase : null, barVisible: !!bar && !bar.classList.contains("hidden"), hud: document.getElementById("turn-text")?.textContent?.trim(), cover: !document.getElementById("pass-cover").classList.contains("hidden") }; });
for (const sc of scenarios) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") errors.push("worker-console: " + m.text().slice(0, 160)); }));
  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.type() + ":" + d.message().slice(0, 80)); await d.accept(); });
  const res = { name: sc.name, steps: {} };
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.click(`.game-tab[data-game="${sc.game}"]`);
    for (const [sel, val] of Object.entries(sc.set || {})) await page.selectOption(sel, val);
    await page.click("#start-btn");
    await page.waitForSelector("#game-screen.active", { timeout: 60000 });
    await page.waitForFunction(() => !!window.__ACTIVE_SESSION__, null, { timeout: 90000 });
    await page.waitForTimeout(8000);
    if (await page.locator("#pass-cover").isVisible()) await page.click("#pass-cover-btn");
    res.before = await snap(page);
    await page.click("#menu-btn");
    await page.waitForTimeout(600);
    res.menuItems = await page.$$eval("#game-menu-items button", (bs) => bs.map((b) => (b.textContent || "").trim().slice(0, 60)));
    const cand = await page.$$("#game-menu-items button");
    let clicked = null;
    for (const b of cand) { const t = ((await b.textContent()) || "").trim(); if (/استسلام|انسحاب|resign|surrender|forfeit/i.test(t)) { await b.click(); clicked = t; break; } }
    res.steps.resignItem = clicked;
    await page.waitForTimeout(2500);
    res.afterResignClick = await snap(page);
        await page.screenshot({ path: `shots-end/${sc.name}-a-after-resign-click.png` });
    // Confirm the in-canvas popup with a REAL touch tap (coordinates read from the popup screenshots; viewport 412x860).
    const TAP = { pool: [283, 599], monsters: [103, 460], brawlbots: [309, 823] }[sc.game];
    res.tap = TAP;
    res.tapAttempts = [];
    const pointerSeen = await page.evaluate(() => { window.__pt = []; const c = document.getElementById("game-canvas"); for (const ev of ["pointerdown", "pointerup", "touchstart", "mousedown", "click"]) c.addEventListener(ev, (e) => window.__pt.push(ev + ":" + (e.pointerType || "") + ":" + Math.round(e.clientX) + "," + Math.round(e.clientY))); return true; });
    for (const mode of ["mouse", "touch", "mouse-slow"]) {
      if (mode === "touch") await page.touchscreen.tap(TAP[0], TAP[1]);
      else if (mode === "mouse") await page.mouse.click(TAP[0], TAP[1]);
      else { await page.mouse.move(TAP[0], TAP[1]); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up(); }
      await page.waitForTimeout(2500);
      const sn = await snap(page);
      res.tapAttempts.push({ mode, gameOver: sn.gameOver, bar: sn.barVisible, pt: await page.evaluate(() => (window.__pt || []).splice(0).slice(0, 8)) });
      if (sn.gameOver || sn.barVisible) break;
    }
    let over = null;
    for (let w = 0; w < 12; w++) { await page.waitForTimeout(1000); over = await snap(page); if (over.gameOver || over.barVisible) break; }
    res.afterConfirm = over;
    await page.screenshot({ path: `shots-end/${sc.name}-b-after-confirm.png` });
    if (over.barVisible) {
      await page.click("#rematch-btn");
      let fresh = null;
      for (let w = 0; w < 20; w++) { await page.waitForTimeout(1000); fresh = await snap(page); if (!fresh.gameOver && !fresh.barVisible) break; }
      res.afterRematch = fresh;
      await page.waitForTimeout(4000);
      res.afterRematch2 = await snap(page);
      await page.screenshot({ path: `shots-end/${sc.name}-c-after-rematch.png` });
    }
  } catch (e) { res.steps.error = String(e.message).slice(0, 200); }
  res.errCount = errors.length; res.nonBenign = errors.filter((e) => !/Failed to load|music/.test(e)).slice(0, 4); res.dialogs = dialogs;
  out.push(res);
  await ctx.close();
}
console.log("ENDGAME " + JSON.stringify(out));
await browser.close(); server.kill();
