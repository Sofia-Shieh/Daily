import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.route("**/api/local-history", route => route.fulfill({ json: { transactions: [], metadata: {} } }));
await page.goto(process.env.BASE_URL || "http://localhost:5173");
await page.getByText("基于 0 笔消费记录", { exact: false }).waitFor();
for (const width of [360, 390, 768, 1024, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  for (const tab of ["预算总览", "消费明细", "账单导入", "预算设置"]) {
    const map = {
      预算总览: "预算",
      消费明细: "明细",
      账单导入: "导入",
      预算设置: "设置",
    };
    await page
      .locator(width <= 760 ? ".mobile-nav" : ".desktop-nav")
      .getByRole("button", { name: width <= 760 ? map[tab] : tab, exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `${width}px ${tab} overflow`,
    );
  }
}
console.log(
  "PASS: 4 pages x 6 viewport widths (360–1920px), no horizontal page overflow.",
);
await browser.close();
