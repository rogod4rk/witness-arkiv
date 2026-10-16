// Screenshots of the live app, one per narrated sentence, caption burned into the page.
// Usage: node scripts/capture.mjs <outDir>  -> writes <outDir>/NN.png and <outDir>/manifest.tsv
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const out = process.argv[2];
const base = process.env.APP_URL ?? "https://arkiv-entry.vercel.app";
const explorer = "https://tiramisu.explorer.arkiv.network";
const demo = JSON.parse(readFileSync(new URL("../src/demo.json", import.meta.url), "utf8"));
const scenes = JSON.parse(readFileSync(new URL("./video-scenes.json", import.meta.url), "utf8"));
const chrome = `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base }).catch(() => {});

const zoom = () => page.addStyleTag({ content: "body{zoom:1.6;padding-bottom:220px}" });
const settle = () => page.waitForTimeout(1500);

async function show(view) {
  if (view === "home") { await page.goto(base); await zoom(); await settle(); }
  else if (view === "explorer") {
    const url = process.env.DEMO_TX ? `${explorer}/tx/${process.env.DEMO_TX}`
      : demo.writer ? `${explorer}/address/${demo.writer}` : explorer;
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);
  } else if (view === "audit") {
    if (page.url().startsWith(base) && await page.$("#verify")) { /* already on app */ }
    else { await page.goto(base); await zoom(); }
    if (demo.writer) {
      await page.fill("#w", demo.writer); await page.fill("#l", demo.log); await page.fill("#k", demo.key);
    }
    await page.click("#verify");
    await page.waitForFunction(() => document.querySelector("#out")?.textContent?.trim(), null, { timeout: 40000 }).catch(() => {});
    await settle();
    await page.evaluate(() => document.querySelector("#out")?.scrollIntoView({ block: "center" }));
  } else if (view === "write") {
    await page.goto(base); await zoom(); await settle();
    await page.evaluate(() => document.querySelector("#append")?.scrollIntoView({ block: "center" }));
    await page.click("#append");
    await page.waitForFunction(() => /Written|rror|fail|fund/i.test(document.querySelector("#wout")?.textContent ?? ""), null, { timeout: 40000 }).catch(() => {});
    await settle();
  }
}

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("cap");
    if (!el) {
      el = document.createElement("div"); el.id = "cap";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;zoom:1;padding:22px 120px 34px;background:rgba(0,0,0,.82);color:#fff;font:600 34px/1.35 ui-sans-serif,system-ui,sans-serif;text-align:center";
      document.documentElement.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

const rows = [];
let n = 0;
for (const s of scenes) {
  await show(s.view);
  for (const text of s.say) {
    await caption(text);
    const f = `${String(++n).padStart(2, "0")}.png`;
    await page.screenshot({ path: `${out}/${f}` });
    rows.push(`${f}\t${text}`);
  }
}
writeFileSync(`${out}/manifest.tsv`, rows.join("\n") + "\n");
await browser.close();
