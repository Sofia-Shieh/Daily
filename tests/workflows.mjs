import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/local-history", (route) =>
  route.fulfill({ json: { transactions: [], metadata: {} } }),
);
await page.goto(process.env.BASE_URL || "http://localhost:5173");
await page.getByText("基于 0 笔消费记录", { exact: false }).waitFor();
// A synthetic profile exercises behavior without publishing anyone's finances.
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("daily-budget-v1"));
  const monthly = { clothing: 100, beauty: 50, food: 200 };
  state.categories = state.categories.map(c => ({ ...c, monthly: monthly[c.id] || 0, bonus: 0, annual: (monthly[c.id] || 0) * 12, history16: null, recent4: null }));
  state.settings = { startMonth: "2026-11", asOf: "2026-11-11", rollover: true, monthlyIncome: 4000, savingsGoal: 500, installments: 0 };
  state.transactions = [];
  state.batches = [];
  localStorage.setItem("daily-budget-v1", JSON.stringify(state));
});
await page.reload();
await page.locator(".category-card").first().waitFor();

const nav = async (name) =>
  page
    .locator(".mobile-nav")
    .getByRole("button", { name, exact: true })
    .click();
const csv =
  "日期,商户,说明,金额,类目,收支类型,交易号,原交易号,平台\n2026-11-11,衣服店,计划服装,100,服饰鞋包,支出,test-clothes,,标准测试\n2026-11-11,护肤店,补货护肤,100,美妆护肤,支出,test-beauty,,标准测试\n2026-11-11,转账,本人调拨,5000,,调拨,test-transfer,,标准测试\n2026-11-11,衣服店,部分退款,20,,退款,test-refund,test-clothes,标准测试\n2026-11-11,用途未知商户,未知商品,120,,支出,test-pending,,标准测试\n";
const fixture = {
  name: "测试账单.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(csv),
};
await nav("导入");
await page.locator("input[type=file][multiple]").setInputFiles(fixture);
await page.getByRole("button", { name: "确认导入 5 笔" }).click();
await nav("预算");
const clothing = page
  .locator(".category-card")
  .filter({ has: page.getByRole("heading", { name: "服饰", exact: true }) });
assert.match(await clothing.innerText(), /220/);
assert.match(await clothing.innerText(), /1,120/);
assert.equal(
  (await page.locator(".hero-amount").innerText()).replace(/\s/g, ""),
  "¥750.00",
);
await nav("导入");
await page.locator("input[type=file][multiple]").setInputFiles(fixture);
await page.getByRole("dialog").waitFor();
assert.equal(
  await page.locator(".import-stats>div").nth(1).locator("strong").innerText(),
  "5",
);
await page.getByRole("button", { name: "取消", exact: true }).click();
await nav("明细");
await page.getByLabel("筛选类目").selectOption("review");
await page.locator(".ledger-row").filter({ hasText: "用途未知商户" }).click();
let dialog = page.getByRole("dialog");
await dialog.getByLabel("消费类目", { exact: true }).selectOption("food");
await dialog.getByLabel("我已核对用途与金额").check();
await dialog.getByRole("button", { name: "保存修改" }).click();
await nav("预算");
assert.equal(
  (await page.locator(".hero-amount").innerText()).replace(/\s/g, ""),
  "¥750.00",
);
await clothing.click();
dialog = page.getByRole("dialog");
await dialog.getByRole("button", { name: "消费前试算" }).click();
dialog = page.getByRole("dialog");
await dialog.getByRole("spinbutton").fill("320");
assert.match(await dialog.innerText(), /−?100\.00|-100\.00/);
assert.match(await dialog.innerText(), /本季已不足/);
await dialog.getByRole("button", { name: "关闭" }).click();
await nav("设置");
await page.getByLabel("服饰鞋包工资每月预留").fill("150");
await page
  .getByRole("button", { name: "保存预算", exact: true })
  .first()
  .click();
await nav("预算");
assert.match(await clothing.innerText(), /370/);
await page.reload();
await page.locator(".category-card").first().waitFor();
assert.match(await clothing.innerText(), /370/);
await page.getByLabel("预算查看截至日期").fill("2027-02-11");
assert.match(await clothing.innerText(), /820/); // 2 quarters x 450 minus net80
await nav("设置");
await page.getByLabel("季度结余自动结转", { exact: false }).uncheck();
await page
  .getByRole("button", { name: "保存预算", exact: true })
  .first()
  .click();
await nav("预算");
assert.match(await clothing.innerText(), /450/);
await nav("明细");
await page.getByLabel("筛选类目").selectOption("all");
await page.getByLabel("搜索消费").fill("衣服店");
await page.locator(".ledger-row").filter({ hasText: "计划服装" }).click();
dialog = page.getByRole("dialog");
await dialog.getByRole("button", { name: "排除本笔消费" }).click();
await page.getByRole("status").waitFor();
assert.match(await page.getByRole("status").innerText(), /退款|关联/);
await dialog.getByRole("button", { name: "关闭" }).click();
await page.getByLabel("搜索消费").fill("");
await page.getByLabel("筛选类目").selectOption("excluded");
assert.match(await page.locator(".ledger-list").innerText(), /转账/);
await nav("导入");
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "导出完整备份" }).click();
const dl = await downloadPromise;
assert.match(dl.suggestedFilename(), /留白预算备份/);
const backupPath = await dl.path();
await page.evaluate(() => {
  const v = JSON.parse(localStorage.getItem("daily-budget-v1"));
  v.transactions = [];
  localStorage.setItem("daily-budget-v1", JSON.stringify(v));
});
await page.reload();
await nav("导入");
page.once("dialog", (d) => d.accept());
await page
  .locator('input[type=file][accept=".json"]')
  .setInputFiles(backupPath);
await page.getByText("备份已恢复", { exact: true }).waitFor();
await nav("明细");
await page.getByLabel("筛选类目").selectOption("all");
assert.equal(await page.locator(".ledger-row").count(), 4);
assert.deepEqual(errors, []);
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
console.log(
  "PASS: mobile import, duplicate prevention, review edits, budget totals, purchase calculator, settings, persistence, rollover, refund protection, excluded audit, backup.",
);
await context.close();
await browser.close();
