/**
 * Step 0 / critique-loop screenshots. Self-signed Vite HTTPS is ignored.
 * Usage: node docs/redesign/capture.mjs [before|after]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const SLOT = process.argv[2] === "after" ? "after" : "before";
const BASE = process.env.CR_BASE_URL || "https://localhost:5173";
const OUT = join(ROOT, SLOT);

const ROUTES = [
  ["landing", "/"],
  ["login", "/login"],
  ["login-signup", "/login?signup=1"],
  ["privacy", "/privacy"],
  ["dashboard", "/dashboard"],
  ["profile", "/profile"],
  ["learn", "/learn"],
  ["learn-onboarding", "/learn/onboarding"],
  ["learn-review", "/learn/review"],
  ["learn-practice", "/learn/practice"],
  ["learn-analytics", "/learn/analytics"],
  ["learn-notes", "/learn/notes"],
  ["learn-studio", "/learn/studio"],
  ["course-missing", "/course/study-placeholder"],
];

const VIEWPORTS = [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
];

const browser = await chromium.launch({ headless: true });
await mkdir(OUT, { recursive: true });
const manifest = [];

for (const [name, path] of ROUTES) {
  for (const [label, viewport] of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      ignoreHTTPSErrors: true,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      try { sessionStorage.setItem("cr_intro_seen", "1"); } catch { /* ignore */ }
    });
    const url = BASE + path;
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(700);
    const file = `${name}-${label}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: true });
    const title = await page.title();
    const finalUrl = page.url();
    manifest.push({
      name,
      path,
      viewport: label,
      file: `${SLOT}/${file}`,
      status: response?.status() ?? null,
      title,
      finalUrl,
      redirected: !finalUrl.endsWith(path.split("?")[0]) && !finalUrl.includes(path),
    });
    await context.close();
  }
}

// Brand intro, first visit only
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try { sessionStorage.removeItem("cr_intro_seen"); } catch { /* ignore */ }
  });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, "intro-1440.png") });
  manifest.push({ name: "intro", path: "/", viewport: "1440", file: `${SLOT}/intro-1440.png` });
  await context.close();
}

await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`Wrote ${manifest.length} shots to ${OUT}`);
