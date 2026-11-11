import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  computeBudget,
  defaultCategories as publicCategories,
  defaultSettings as publicSettings,
  getPeriod,
  type Transaction,
} from "../src/lib/model.ts";
import {
  deduplicate,
  parseBill,
  parseDelimited,
  rowsToTransactions,
} from "../src/lib/importer.ts";
import {
  validateAndNormalizeTransaction,
  validateTransactionExclusion,
  removeBatchTransactions,
} from "../src/lib/editor.ts";

// Explicit synthetic fixtures: never derive test budgets from a person's profile.
const defaultCategories = publicCategories.map((category) => ({
  ...category,
  monthly: category.id === "clothing" ? 500 : 0,
  bonus: 0,
  annual: category.id === "clothing" ? 6000 : 0,
}));
const defaultSettings = {
  ...publicSettings,
  startMonth: "2026-11",
  asOf: "2026-11-11",
  rollover: true,
  monthlyIncome: 4000,
  savingsGoal: 500,
  installments: 0,
};

test("public defaults contain no personal balances, history or income", () => {
  assert.equal(publicCategories.length, 15);
  assert.ok(publicCategories.every(c => c.monthly === 0 && c.bonus === 0 && c.annual === 0 && c.history16 === null && c.recent4 === null));
  assert.equal(publicSettings.monthlyIncome, 0);
  assert.equal(publicSettings.savingsGoal, 0);
  assert.equal(publicSettings.installments, 0);
  assert.match(publicSettings.startMonth, /^\d{4}-\d{2}$/);
  assert.match(publicSettings.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

const tx = (patch: Partial<Transaction> = {}): Transaction => ({
  id: "test",
  date: "2026-11-12",
  merchant: "test",
  description: "test",
  amount: 10000,
  categoryId: "clothing",
  kind: "expense",
  review: false,
  source: "通用账单",
  ...patch,
});

test("rolling budget keeps annual and quarter balances independent, carries prior overspend, ignores future and nonconsumption", () => {
  const settings = { ...defaultSettings, asOf: "2027-02-15" };
  const data = [
    tx({ id: "q1", amount: 180000 }),
    tx({ id: "q2", date: "2027-02-02", amount: 10000 }),
    tx({ id: "future", date: "2027-02-20", amount: 999999 }),
    tx({ id: "old", date: "2026-10-01", amount: 999999 }),
    tx({ id: "income", date: "2027-02-03", kind: "income", amount: 999999 }),
    tx({
      id: "repayment",
      date: "2027-02-03",
      kind: "repayment",
      amount: 999999,
    }),
  ];
  const result = computeBudget(data, defaultCategories, settings);
  const clothing = result.categories.find((c) => c.id === "clothing")!;
  assert.equal(result.period.quarter, 2);
  assert.equal(result.period.yearStart, "2026-11-01");
  assert.equal(clothing.quarterBudget, 150000);
  assert.equal(clothing.carry, -30000);
  assert.equal(clothing.quarterRemaining, 110000);
  assert.equal(clothing.annualRemaining, 410000);
  assert.equal(clothing.monthSpent, 10000);
  assert.equal(
    computeBudget(data, defaultCategories, {
      ...settings,
      rollover: false,
    }).categories.find((c) => c.id === "clothing")!.quarterRemaining,
    140000,
  );
});

test("review expense reduces conservative reserve, review refund never creates spending capacity", () => {
  const result = computeBudget(
    [
      tx({ date: "2026-11-05", review: true, amount: 12345 }),
      tx({
        id: "refund",
        date: "2026-11-05",
        review: true,
        kind: "refund",
        amount: -5000,
      }),
      tx({
        id: "transfer",
        date: "2026-11-05",
        kind: "transfer",
        amount: 99999,
      }),
    ],
    defaultCategories,
    defaultSettings,
  );
  assert.equal(result.total.yearSpent, 0);
  assert.equal(result.total.pendingAmount, 12345);
  assert.equal(result.total.pendingCount, 2);
});

test("annual rollover resets spending but preserves arbitrary cycle start; before initial start never includes history", () => {
  assert.equal(
    getPeriod({ ...defaultSettings, asOf: "2027-11-01" }).yearStart,
    "2027-11-01",
  );
  const result = computeBudget(
    [tx({ date: "2026-10-01" })],
    defaultCategories,
    { ...defaultSettings, asOf: "2026-10-31" },
  );
  assert.equal(result.period.active, false);
  assert.equal(result.total.yearSpent, 0);
  assert.equal(
    defaultCategories.reduce((s, c) => s + Math.round(c.annual * 100), 0),
    600000,
  );
});

test("CSV parser handles multiline quoted description, commas and double quote escaping", () => {
  const rows = parseDelimited(
    '日期,商户,说明,金额,类目\r\n2026-11-03,"商户,分店","衬衫\n""秋冬""",123.45,服饰鞋包\r\n',
  );
  assert.equal(rows[1][1], "商户,分店");
  assert.equal(rows[1][2], '衬衫\n"秋冬"');
  const imported = rowsToTransactions(rows);
  assert.equal(imported.transactions[0].amount, 12345);
  assert.equal(imported.transactions[0].categoryId, "clothing");
});

test("Alipay refund is attributed to original purchase and original unknown refunds stay pending", () => {
  const data = rowsToTransactions([
    ["支付宝明细"],
    [
      "交易时间",
      "交易分类",
      "交易对方",
      "商品说明",
      "收/支",
      "金额",
      "交易状态",
      "交易订单号",
    ],
    [
      "2026-10-20 09:00:00",
      "服饰装扮",
      "品牌店",
      "衬衫",
      "支出",
      100,
      "交易成功",
      "order1",
    ],
    [
      "2026-11-05 09:00:00",
      "退款",
      "品牌店",
      "退款-衬衫",
      "不计收支",
      20,
      "退款成功",
      "order1_refund1",
    ],
    [
      "2026-11-05 09:00:00",
      "退款",
      "品牌店",
      "退款",
      "不计收支",
      50,
      "退款成功",
      "unknown_refund1",
    ],
  ]);
  const [purchase, refund, unknown] = data.transactions;
  assert.equal(purchase.amount, 10000);
  assert.equal(refund.date, "2026-10-20");
  assert.equal(refund.amount, -2000);
  assert.equal(refund.review, false);
  assert.equal(unknown.review, true);
});

test("multiple refunds cannot credit more than original purchase", () => {
  const data = rowsToTransactions([
    ["日期", "商户", "说明", "金额", "类目", "收支类型", "交易号", "原交易号"],
    ["2026-11-01", "品牌", "衬衫", 100, "服饰鞋包", "支出", "o1", ""],
    ["2026-11-03", "品牌", "退货", 60, "服饰鞋包", "退款", "r1", "o1"],
    ["2026-11-04", "品牌", "退货", 60, "服饰鞋包", "退款", "r2", "o1"],
  ]);
  assert.equal(data.transactions[1].review, true);
  assert.equal(data.transactions[2].review, true);
});

test("order-id dedup preserves audited net amount and does not credit historical refunds twice", () => {
  const existing = [
    tx({
      externalId: "o1",
      amount: 8000,
      source: "支付宝",
      note: "历史净额已含截至2026-11-05退款与AA调整。",
    }),
  ];
  const incoming = [
    tx({ id: "another", externalId: "o1", amount: 10000, source: "支付宝" }),
    tx({
      id: "refund",
      kind: "refund",
      externalId: "o1_refund",
      originalId: "o1",
      amount: -2000,
      source: "支付宝",
      review: true,
    }),
  ];
  const result = deduplicate(existing, incoming);
  assert.equal(result.duplicates, 1);
  assert.equal(result.newTransactions.length, 1);
  assert.equal(result.newTransactions[0].review, true);
  assert.equal(existing[0].amount, 8000);
  assert.ok(result.warnings.some((w) => w.includes("保留已有净额")));
});

test("cross-source same bank payment is flagged, same-merchant separate order ids are retained", () => {
  const existing = [tx({ externalId: "o1", source: "支付宝" })];
  const result = deduplicate(existing, [
    tx({ id: "bank", externalId: "b1", source: "银行" }),
    tx({ id: "o2", externalId: "o2", source: "支付宝" }),
  ]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.newTransactions.length, 2);
  assert.equal(
    result.newTransactions.find((t) => t.id === "bank")!.review,
    true,
  );
});

test("WeChat XLSX date cells and canceled trades parse correctly", async () => {
  const rows = [
    ["微信支付账单明细"],
    [
      "交易时间",
      "交易类型",
      "交易对方",
      "商品",
      "收/支",
      "金额(元)",
      "当前状态",
      "交易单号",
    ],
    [
      new Date("2026-11-01T12:00:00Z"),
      "商户消费",
      "咖啡店",
      "咖啡",
      "支出",
      24.5,
      "支付成功",
      "wx1",
    ],
    [
      new Date("2026-11-01T12:00:00Z"),
      "商户消费",
      "咖啡店",
      "咖啡",
      "支出",
      25,
      "支付失败",
      "wx2",
    ],
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "账单");
  const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const file = new File([buffer], "微信账单.xlsx");
  const result = await parseBill(file);
  assert.equal(result.source, "微信");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].date, "2026-11-01");
  assert.equal(result.transactions[0].amount, 2450);
  assert.ok(result.warnings.some((w) => w.includes("跳过")));
});

test("repeat import without external ids remains stable while repeated identical rows remain distinct", () => {
  const rows = [
    ["日期", "商户", "说明", "金额"],
    ["2026-11-02", "咖啡店", "咖啡", 20],
    ["2026-11-02", "咖啡店", "咖啡", 20],
  ];
  const first = rowsToTransactions(rows).transactions;
  assert.equal(new Set(first.map((t) => t.id)).size, 2);
  assert.equal(
    deduplicate(first, rowsToTransactions(rows).transactions).duplicates,
    2,
  );
});

test("manual editor validates dates, cents and confirmed categories and restores excluded expense", () => {
  assert.throws(
    () => validateAndNormalizeTransaction(tx({ date: "2026-02-30" }), []),
    /有效日期/,
  );
  assert.throws(
    () => validateAndNormalizeTransaction(tx({ amount: 0 }), []),
    /金额/,
  );
  assert.throws(
    () => validateAndNormalizeTransaction(tx({ amount: 100.1 }), []),
    /金额/,
  );
  assert.throws(
    () =>
      validateAndNormalizeTransaction(tx({ categoryId: "uncategorized" }), []),
    /类目/,
  );
  const saved = validateAndNormalizeTransaction(
    tx({ amount: -12345, excluded: true }),
    [],
  );
  assert.equal(saved.amount, 12345);
  assert.equal(saved.excluded, false);
  assert.equal(
    validateAndNormalizeTransaction(tx({ kind: "transfer", review: true }), [])
      .excluded,
    true,
  );
});

test("manual confirmed refund inherits original date/category/source and checks cumulative refund maximum", () => {
  const original = tx({
    id: "purchase",
    date: "2026-10-01",
    externalId: "external",
    amount: 10000,
    source: "微信",
  });
  const oldRefund = tx({
    id: "r1",
    kind: "refund",
    amount: -3000,
    originalId: "external",
    source: "微信",
  });
  const refund = tx({
    id: "r2",
    kind: "refund",
    amount: 7000,
    date: "2026-11-01",
    categoryId: "uncategorized",
    originalId: "purchase",
  });
  const saved = validateAndNormalizeTransaction(refund, [original, oldRefund]);
  assert.equal(saved.amount, -7000);
  assert.equal(saved.date, "2026-10-01");
  assert.equal(saved.categoryId, "clothing");
  assert.equal(saved.source, "微信");
  assert.equal(saved.originalId, "purchase");
  assert.throws(
    () =>
      validateAndNormalizeTransaction({ ...refund, amount: 7001 }, [
        original,
        oldRefund,
      ]),
    /累计退款/,
  );
  // Editing an existing refund must not count itself twice.
  assert.equal(
    validateAndNormalizeTransaction(saved, [original, oldRefund, saved]).amount,
    -7000,
  );
});

test("manual historical-net refund needs explicit acknowledgment and invalid originals are rejected", () => {
  const original = tx({
    id: "purchase",
    note: "历史净额已含截至2026-11-05退款与AA调整。",
  });
  const refund = tx({
    id: "refund",
    kind: "refund",
    amount: -1000,
    originalId: "purchase",
  });
  assert.throws(
    () => validateAndNormalizeTransaction(refund, [original]),
    /尚未抵扣/,
  );
  assert.equal(
    validateAndNormalizeTransaction(refund, [original], {
      acknowledgeHistoricalNet: true,
    }).amount,
    -1000,
  );
  assert.throws(
    () =>
      validateAndNormalizeTransaction(refund, [{ ...original, review: true }]),
    /先确认原消费/,
  );
  assert.throws(
    () =>
      validateAndNormalizeTransaction(refund, [
        { ...original, excluded: true },
      ]),
    /已排除/,
  );
  assert.throws(
    () => validateAndNormalizeTransaction(refund, [{ ...original, amount: 0 }]),
    /净额为零/,
  );
  assert.throws(
    () => validateAndNormalizeTransaction({ ...refund, originalId: "" }, []),
    /选择对应/,
  );
  assert.equal(
    validateAndNormalizeTransaction(
      { ...refund, review: true, originalId: "" },
      [],
    ).review,
    true,
  );
});

test("editing original cannot invalidate confirmed refunds by reducing amount or changing period/category", () => {
  const original = tx({ id: "purchase" });
  const refund = tx({
    id: "refund",
    kind: "refund",
    originalId: "purchase",
    amount: -5000,
  });
  assert.throws(
    () =>
      validateAndNormalizeTransaction({ ...original, amount: 4999 }, [
        original,
        refund,
      ]),
    /不能小于/,
  );
  assert.throws(
    () =>
      validateAndNormalizeTransaction({ ...original, categoryId: "food" }, [
        original,
        refund,
      ]),
    /已关联退款/,
  );
  assert.throws(
    () =>
      validateAndNormalizeTransaction({ ...original, date: "2027-02-01" }, [
        original,
        refund,
      ]),
    /已关联退款/,
  );
  assert.throws(
    () =>
      validateAndNormalizeTransaction({ ...original, kind: "transfer" }, [
        original,
        refund,
      ]),
    /改为非消费/,
  );
  assert.throws(
    () => validateTransactionExclusion(original, [original, refund]),
    /排除原消费/,
  );
});

test("zero-amount template rows are ignored with warning", () => {
  const result = rowsToTransactions([
    ["日期", "商户", "说明", "金额"],
    ["2026-11-02", "咖啡店", "咖啡", 0],
    ["2026-11-02", "咖啡店", "咖啡", 20],
  ]);
  assert.equal(result.transactions.length, 1);
  assert.ok(result.warnings.some((w) => w.includes("零金额")));
});

test("WeChat incoming merchant-refund events stay reviewable refunds, while original refunded expense stays a pending expense", () => {
  const result = rowsToTransactions(
    [
      ["微信支付账单明细"],
      [
        "交易时间",
        "交易类型",
        "交易对方",
        "商品",
        "收/支",
        "金额(元)",
        "当前状态",
        "交易单号",
      ],
      [
        "2026-11-02 12:00:00",
        "咖啡店-退款",
        "咖啡店",
        "/",
        "收入",
        20,
        "已全额退款",
        "r1",
      ],
      [
        "2026-11-01 12:00:00",
        "商户消费",
        "咖啡店",
        "咖啡",
        "支出",
        20,
        "已全额退款",
        "o1",
      ],
    ],
    "微信账单.xlsx",
  );
  assert.equal(result.transactions[0].kind, "refund");
  assert.equal(result.transactions[0].review, true);
  assert.equal(result.transactions[0].excluded, false);
  assert.equal(result.transactions[0].amount, -2000);
  assert.equal(result.transactions[1].kind, "expense");
  assert.equal(result.transactions[1].review, true);
});

test("undoing an original import batch keeps later refunds pending without touching unrelated edits", () => {
  const original = tx({
    id: "purchase",
    externalId: "order1",
    source: "微信",
    date: "2026-11-01",
  });
  const byId = tx({
    id: "refund1",
    originalId: "purchase",
    kind: "refund",
    amount: -2000,
    date: "2026-11-01",
  });
  const byExternalId = tx({
    id: "refund2",
    originalId: "order1",
    source: "微信",
    kind: "refund",
    amount: -1000,
    date: "2026-11-01",
  });
  const unrelated = tx({
    id: "other",
    note: "用户已经手动修改的备注",
    amount: 9876,
  });
  const existing = [original, byId, byExternalId, unrelated];
  const removedOriginal = removeBatchTransactions(existing, [original.id]);
  assert.equal(removedOriginal.length, 3);
  assert.equal(removedOriginal.find((t) => t.id === "refund1")!.review, true);
  assert.equal(removedOriginal.find((t) => t.id === "refund2")!.review, true);
  assert.match(
    removedOriginal.find((t) => t.id === "refund1")!.note!,
    /原消费已随导入批次撤销/,
  );
  assert.equal(
    removedOriginal.find((t) => t.id === "other"),
    unrelated,
  );
  assert.equal(
    computeBudget(removedOriginal, defaultCategories, defaultSettings).total
      .yearSpent,
    0,
  );
  const removedRefund = removeBatchTransactions(existing, [byId.id]);
  assert.equal(
    removedRefund.find((t) => t.id === "purchase"),
    original,
  );
  assert.equal(removedRefund.find((t) => t.id === "refund2")!.review, false);
  assert.equal(existing[1].review, false);
});
