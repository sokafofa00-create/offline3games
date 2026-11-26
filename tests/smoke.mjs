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
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-1-start.png` });
    const box = await page.locator("#game-canvas").boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 6 });
      await page.mouse.up();
    }
    await page.waitForTimeout(3000);
    res.steps.hud2 = (await page.textContent("#turn-text"))?.trim();
    await page.screenshot({ path: `${SHOT_DIR}/${sc.name}-2-after-input.png` });
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
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Smoke results\n```json\n" + JSON.stringify(results, null, 1).slice(0, 60000) + "\n```\n");
console.log("SMOKE_RESULTS " + JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.errors.length || r.externalRequests.length || !r.steps.rematchClicked);
if (bad.length) { console.log("FAILED: " + bad.map((b) => b.name).join(", ")); process.exit(1); }
