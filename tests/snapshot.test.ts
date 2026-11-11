import test from "node:test";
import assert from "node:assert/strict";
import { defaultCategories, defaultSettings } from "../src/lib/model.ts";
import {
  parseSnapshot,
  snapshotFingerprint,
  type BudgetSnapshot,
} from "../src/lib/snapshot.ts";

const fixture = (): BudgetSnapshot => ({
  version: 1,
  categories: defaultCategories.map((item) => ({ ...item })),
  settings: { ...defaultSettings, startMonth: "2030-01", asOf: "2030-01-08" },
  transactions: [
    {
      id: "test-order-1",
      date: "2030-01-03",
      merchant: "示例店铺",
      description: "测试消费",
      amount: 1200,
      categoryId: "food",
      kind: "expense",
      review: false,
      source: "测试账单",
    },
  ],
  batches: [],
  funds: {},
  saved: {},
  metadata: {
    latestDate: "2030-01-03",
    history16: { startDate: "2028-09-01", endDate: "2029-12-31" },
  },
});

test("snapshot validates public defaults and returns isolated normalized structures", () => {
  const input = fixture();
  const parsed = parseSnapshot(input);
  assert.deepEqual(parsed, input);
  parsed.categories[0].annual = 100;
  parsed.transactions[0].merchant = "changed";
  (parsed.metadata!.history16 as Record<string, string>).startDate = "changed";
  assert.equal(input.categories[0].annual, 0);
  assert.equal(input.transactions[0].merchant, "示例店铺");
  assert.equal(
    (input.metadata!.history16 as Record<string, string>).startDate,
    "2028-09-01",
  );
});

test("legacy optional snapshot collections receive safe defaults", () => {
  const { batches, funds, saved, metadata, ...input } = fixture();
  const parsed = parseSnapshot(input);
  assert.deepEqual(parsed.batches, []);
  assert.deepEqual(parsed.funds, {});
  assert.deepEqual(parsed.saved, {});
  assert.deepEqual(parsed.metadata, {});
});

test("snapshot rejects duplicate identifiers and incompatible financial types", () => {
  const duplicate = fixture();
  duplicate.transactions.push({ ...duplicate.transactions[0] });
  assert.throws(() => parseSnapshot(duplicate), /编号重复/);
  const categories = fixture();
  categories.categories[1] = { ...categories.categories[0] };
  assert.throws(() => parseSnapshot(categories), /类目重复/);
  assert.throws(
    () =>
      parseSnapshot({
        ...fixture(),
        settings: { ...fixture().settings, monthlyIncome: "4000" },
      }),
    /普通工资/,
  );
  assert.throws(
    () => parseSnapshot({ ...fixture(), funds: { food: 1.5 } }),
    /整数/,
  );
  assert.throws(
    () => parseSnapshot({ ...fixture(), saved: { "not-a-month": 100 } }),
    /月份/,
  );
  assert.throws(
    () =>
      parseSnapshot({
        ...fixture(),
        categories: fixture().categories.map((c, i) =>
          i === 0 ? { ...c, recent4: Infinity } : c,
        ),
      }),
    /历史参考/,
  );
});

test("snapshot validates real calendar dates and rejects unsafe metadata", () => {
  const invalid = fixture();
  invalid.transactions[0].date = "2030-02-30";
  assert.throws(() => parseSnapshot(invalid), /有效日期/);
  const invalidMonth = fixture();
  invalidMonth.settings.startMonth = "2030-13";
  assert.throws(() => parseSnapshot(invalidMonth), /有效月份/);
  assert.throws(
    () =>
      parseSnapshot({
        ...fixture(),
        metadata: JSON.parse('{"__proto__":{"polluted":true}}'),
      }),
    /不支持的字段/,
  );
  assert.throws(
    () => parseSnapshot({ ...fixture(), metadata: { unsafe: () => {} } }),
    /JSON/,
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("snapshot preserves valid signed refunds and zero excluded audit rows", () => {
  const input = fixture();
  input.transactions.push({
    ...input.transactions[0],
    id: "test-refund",
    kind: "refund",
    amount: -500,
    originalId: "test-order-1",
  });
  input.transactions.push({
    ...input.transactions[0],
    id: "audit-zero",
    amount: 0,
    excluded: true,
  });
  input.transactions.push({
    ...input.transactions[0],
    id: "unknown",
    categoryId: "uncategorized",
    review: true,
  });
  assert.equal(parseSnapshot(input).transactions.length, 4);
  input.transactions[1].amount = 500;
  assert.throws(() => parseSnapshot(input), /正负方向/);
});

test("snapshot fingerprint ignores local private-entry markers and object key order", async () => {
  const input = fixture();
  const reordered = {
    ...input,
    metadata: {
      history16: { endDate: "2029-12-31", startDate: "2028-09-01" },
      latestDate: "2030-01-03",
      privateSnapshotId: "local",
      privateLoadedAt: "2030-01-08",
      privateSource: "private-entry",
    },
  };
  const digest = await snapshotFingerprint(input);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(await snapshotFingerprint(reordered), digest);
  const changed = fixture();
  changed.transactions[0].amount = 2000;
  assert.notEqual(await snapshotFingerprint(changed), digest);
});
