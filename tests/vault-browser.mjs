import { chromium } from "@playwright/test";
import { createCipheriv, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const base = process.env.BASE_URL || "http://localhost:4173/Daily/";
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
let requests = [];
page.on("request", (r) =>
  requests.push({ url: r.url(), headers: r.headers() }),
);
await page.route("**/api/local-history", (r) =>
  r.fulfill({ json: { transactions: [] } }),
);
await page.goto(base);
await page.getByText("基于 0 笔消费记录", { exact: false }).waitFor();
const snapshot = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("daily-budget-v1")),
);
snapshot.categories = snapshot.categories.map((c) => ({
  ...c,
  monthly: c.id === "clothing" ? 100 : 0,
  annual: c.id === "clothing" ? 1200 : 0,
}));
snapshot.settings = {
  ...snapshot.settings,
  monthlyIncome: 4000,
  savingsGoal: 500,
};
snapshot.transactions = [
  {
    id: "test-original",
    date: snapshot.settings.asOf,
    merchant: "虚拟服饰店",
    description: "测试服饰",
    amount: 6000,
    categoryId: "clothing",
    kind: "expense",
    review: false,
    source: "虚拟测试",
  },
];
snapshot.metadata = { latestDate: snapshot.settings.asOf };
const key = randomBytes(32);
const keyText = key.toString("base64url");
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
cipher.setAAD(Buffer.from("daily-budget-private-v1"));
const ciphertext = Buffer.concat([
  cipher.update(Buffer.from(JSON.stringify(snapshot))),
  cipher.final(),
  cipher.getAuthTag(),
]);
const envelope = {
  version: 1,
  algorithm: "AES-GCM",
  iv: iv.toString("base64url"),
  ciphertext: ciphertext.toString("base64url"),
};
await context.route("**/private-vault.json", (route) =>
  route.fulfill({ json: envelope }),
);
assert.ok(
  !requests.some((r) => r.url.includes("private-vault.json")),
  "public visitors must not fetch a snapshot",
);
requests = [];
await page.goto(`${base}#vault=${keyText}`);
await page.getByText("已载入你的财务分析数据", { exact: true }).waitFor();
assert.equal(await page.evaluate(() => location.hash), "");
assert.ok(
  !requests.some(
    (r) =>
      r.url.includes(keyText) || JSON.stringify(r.headers).includes(keyText),
  ),
  "key must not be transmitted",
);
let stored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("daily-budget-v1")),
);
assert.equal(stored.transactions[0].amount, 6000);
assert.equal(stored.settings.savingsGoal, 500);
assert.equal(stored.categories.find((c) => c.id === "clothing").annual, 1200);
assert.ok(stored.metadata.privateSnapshotId);
assert.ok(!JSON.stringify(stored).includes(keyText));
const clothing = page
  .locator(".category-card")
  .filter({ has: page.getByRole("heading", { name: "服饰", exact: true }) });
assert.match(await clothing.innerText(), /240/);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("daily-budget-v1"));
  s.transactions[0].amount = 9000;
  s.transactions[0].note = "本机后来修改";
  localStorage.setItem("daily-budget-v1", JSON.stringify(s));
});
await page.goto(`${base}?again=1#vault=${keyText}`);
await page
  .getByText("已使用本机账本，后续新增记录和修改已保留", { exact: true })
  .waitFor();
stored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("daily-budget-v1")),
);
assert.equal(stored.transactions[0].amount, 9000);
await page.reload();
assert.match(await clothing.innerText(), /210/);
const conflictContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
await conflictContext.addInitScript((s) => {
  s.transactions[0].id = "local-other";
  s.transactions[0].amount = 7000;
  localStorage.setItem("daily-budget-v1", JSON.stringify(s));
}, snapshot);
await conflictContext.route("**/private-vault.json", (r) =>
  r.fulfill({ json: envelope }),
);
const conflict = await conflictContext.newPage();
await conflict.goto(`${base}#vault=${keyText}`);
await conflict
  .getByRole("dialog", { name: "本机已经有一本生活账。" })
  .waitFor();
assert.equal(
  await conflict.evaluate(
    () =>
      JSON.parse(localStorage.getItem("daily-budget-v1")).transactions[0].id,
  ),
  "local-other",
);
const dl = conflict.waitForEvent("download");
await conflict.getByRole("button", { name: "备份并载入已整理版本" }).click();
await dl;
await conflict.getByText("已载入你的财务分析数据", { exact: true }).waitFor();
assert.equal(
  await conflict.evaluate(
    () =>
      JSON.parse(localStorage.getItem("daily-budget-v1")).transactions[0].id,
  ),
  "test-original",
);
const wrongContext = await browser.newContext();
await wrongContext.route("**/private-vault.json", (r) =>
  r.fulfill({ json: envelope }),
);
const wrong = await wrongContext.newPage();
await wrong.goto(`${base}#vault=${randomBytes(32).toString("base64url")}`);
await wrong.getByRole("alert").filter({ hasText: "无法解锁账本" }).waitFor();
assert.equal(
  await wrong.evaluate(
    () =>
      JSON.parse(localStorage.getItem("daily-budget-v1")).transactions.length,
  ),
  0,
);
assert.equal(await wrong.evaluate(() => location.hash), "");
assert.deepEqual(errors, []);
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
console.log(
  "PASS: private entry decrypts, clears URL, never transmits/stores key, preserves later edits, protects nonempty books, backs up before replacement, and rejects wrong keys.",
);
await browser.close();
