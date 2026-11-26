// LAN lobby protocol test: two browser contexts (two "phones") against the dev relay that stands in for the native transport.
// Proves lobby UI + presence + chat + match card logic. It does NOT prove real Wi-Fi/UDP/TCP behaviour on devices.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 8092;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch();
const errors = [];
const res = { steps: {} };
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + " pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(name + " console: " + m.text()); });
  page.on("dialog", async (d) => { errors.push(name + " dialog: " + d.message()); await d.dismiss(); });
  await page.goto(`http://localhost:${PORT}/`);
  await page.fill("#p1-name", name);
  return { ctx, page };
}
try {
  const A = await phone("أحمد");
  await A.page.click('.mode-tab[data-mode="lan"]');
  await A.page.waitForSelector("#lobby-panel", { state: "visible" });
  res.steps.emptyStateA = (await A.page.textContent("#lobby-players")).includes("لا يوجد أحد");
  const B = await phone("سارة");
  await B.page.click('.mode-tab[data-mode="lan"]');
  await A.page.waitForFunction(() => document.querySelectorAll("#lobby-players .peer-chip").length === 1, null, { timeout: 15000 });
  res.steps.aSeesB = (await A.page.textContent("#lobby-players")).includes("سارة");
  await B.page.waitForFunction(() => document.querySelectorAll("#lobby-players .peer-chip").length === 1, null, { timeout: 15000 });
  res.steps.bSeesA = (await B.page.textContent("#lobby-players")).includes("أحمد");
  await A.page.fill("#lobby-input", "مرحبا من أحمد");
  await A.page.click("#lobby-send");
  await B.page.waitForFunction(() => document.getElementById("lobby-chat").innerText.includes("مرحبا من أحمد"), null, { timeout: 10000 });
  res.steps.chatDelivered = true;
  await B.page.fill("#lobby-input", "أهلا يا أحمد");
  await B.page.keyboard.press("Enter");
  await A.page.waitForFunction(() => document.getElementById("lobby-chat").innerText.includes("أهلا يا أحمد"), null, { timeout: 10000 });
  res.steps.chatReverse = true;
  await A.page.click("#lobby-games-btn");
  res.steps.menuItems = await A.page.locator("#lobby-games-menu button").count();
  await A.page.click('#lobby-games-menu [data-lobby-game="brawlbots"]');
  await B.page.waitForSelector("#lobby-chat .join-btn", { timeout: 10000 });
  res.steps.cardOnB = (await B.page.textContent("#lobby-chat .match-card")).includes("Brawlbots");
  res.steps.cardOnA = (await A.page.textContent("#lobby-chat .match-card")).includes("بانتظار");
  await A.page.screenshot({ path: "shots/lobby-A.png" });
  await B.page.screenshot({ path: "shots/lobby-B.png" });
  await A.ctx.close(); await B.ctx.close();
} catch (e) { res.steps.exception = String(e && e.message).slice(0, 300); }
res.errors = errors;
await browser.close(); server.kill();
const out = JSON.stringify(res, null, 1);
console.log("LOBBY_RESULTS " + out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## LAN lobby protocol test (relay stand-in, two browser contexts)\n```json\n" + out + "\n```\n");
const ok = !res.steps.exception && !errors.length && res.steps.aSeesB && res.steps.bSeesA && res.steps.chatDelivered && res.steps.chatReverse && res.steps.cardOnB && res.steps.cardOnA;
if (!ok) { console.log("FAILED lobby test"); process.exit(1); }
