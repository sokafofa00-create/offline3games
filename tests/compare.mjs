// Renders the start screen of each game at a given checkout with the same renderer and viewport.
// usage: node compare.mjs <rootDir> <outDir>
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const [ROOT, OUT] = process.argv.slice(2);
const PORT = 8091 + (ROOT.includes("base") ? 1 : 0);
fs.mkdirSync(OUT, { recursive: true });
const server = spawn("node", ["serve.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const scen = [["pool", "pool-8ball"], ["monsters", "monsters-normal"], ["brawlbots", "brawlbots-2p"]];
const summary = [];
for (const [game, name] of scen) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 120)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)); });
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.click(`.game-tab[data-game="${game}"]`);
    await page.click("#start-btn");
    await page.waitForSelector("#game-screen.active", { timeout: 60000 });
    await page.waitForTimeout(14000);
    const cover = await page.locator("#pass-cover").isVisible().catch(() => false);
    if (cover) { await page.screenshot({ path: `${OUT}/${name}-cover.png` }); await page.click("#pass-cover-btn"); await page.waitForTimeout(3000); }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    summary.push({ name, ok: true, cover, errCount: errs.length, errs: errs.slice(0, 6) });
  } catch (e) { summary.push({ name, ok: false, err: String(e.message).slice(0, 160), errs: errs.slice(0, 6) }); }
  await ctx.close();
}
console.log("COMPARE " + ROOT + " " + JSON.stringify(summary));
await browser.close(); server.kill();
