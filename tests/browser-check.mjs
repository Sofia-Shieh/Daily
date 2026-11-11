import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/local-history", route => route.fulfill({ json: { transactions: [], metadata: {} } }));
await page.goto(process.env.BASE_URL || "http://localhost:5173");
await page.getByText("基于 0 笔消费记录", { exact: false }).waitFor();
await page.waitForTimeout(800);
await fs.mkdir(".local/screenshots", { recursive: true });
await page.screenshot({
  path: ".local/screenshots/public-empty-desktop.png",
  fullPage: true,
});
console.log(
  "desktop",
  await page.locator(".hero-amount").innerText(),
  "cards",
  await page.locator(".category-card").count(),
  "errors",
  errors,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: ".local/screenshots/public-empty-mobile.png",
  fullPage: true,
});
console.log(
  "mobile overflow",
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);
await page.locator(".mobile-nav").getByRole("button", { name: "明细" }).click();
await page.screenshot({
  path: ".local/screenshots/public-empty-mobile-ledger.png",
  fullPage: true,
});
await page.locator(".mobile-nav").getByRole("button", { name: "设置" }).click();
await page.screenshot({
  path: ".local/screenshots/public-empty-mobile-settings.png",
  fullPage: true,
});
console.log(
  "settings overflow",
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);
await browser.close();
