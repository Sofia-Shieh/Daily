import {
  defaultCategories,
  type Category,
  type Settings,
  type Transaction,
} from "./model";

export type SnapshotBatch = {
  id: string;
  name: string;
  date: string;
  count: number;
  duplicates: number;
  transactionIds: string[];
};

export type BudgetSnapshot = {
  version: 1;
  categories: Category[];
  settings: Settings;
  transactions: Transaction[];
  batches: SnapshotBatch[];
  funds: Record<string, number>;
  saved: Record<string, number>;
  metadata?: { latestDate?: string; [key: string]: unknown };
};

const fail = (detail: string): never => {
  throw new Error(`账本数据无效：${detail}`);
};
const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);
const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const text = (value: unknown, label: string, nonempty = false): string => {
  if (
    typeof value !== "string" ||
    (nonempty && !value.trim()) ||
    value.length > 100000
  )
    return fail(`${label}格式不正确。`);
  return value;
};
const nonnegative = (value: unknown, label: string): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER / 100
  )
    return fail(`${label}必须是有效的非负金额。`);
  return value;
};
const integer = (
  value: unknown,
  label: string,
  allowNegative = false,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (!allowNegative && value < 0)
  )
    return fail(`${label}必须是有效的整数。`);
  return value;
};
const bool = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") return fail(`${label}必须为是或否。`);
  return value;
};
const month = (value: unknown, label: string): string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
    Number(value.slice(0, 4)) < 1000
  )
    return fail(`${label}不是有效月份。`);
  return value;
};
const date = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return fail(`${label}不是有效日期。`);
  const [year, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, m - 1, d));
  if (
    year < 1000 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  )
    return fail(`${label}不是有效日期。`);
  return value;
};

function jsonCopy(value: unknown, depth = 0): unknown {
  if (depth > 30) return fail("附加信息嵌套过深。");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item) => jsonCopy(item, depth + 1));
  if (!record(value)) return fail("附加信息必须是 JSON 数据。");
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (dangerousKeys.has(key)) return fail("附加信息含有不支持的字段。");
    result[key] = jsonCopy(item, depth + 1);
  }
  return result;
}

function amounts(
  value: unknown,
  label: string,
  monthKeys = false,
): Record<string, number> {
  if (value === undefined) return {};
  if (!record(value)) return fail(`${label}格式不正确。`);
  const result: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value)) {
    if (dangerousKeys.has(key)) return fail(`${label}含有不支持的字段。`);
    if (monthKeys) month(key, label);
    result[key] = integer(amount, label);
  }
  return result;
}

/** Validate a decrypted or imported backup before it can affect the active book. */
export function parseSnapshot(value: unknown): BudgetSnapshot {
  if (!record(value) || value.version !== 1)
    return fail("不是受支持的留白账本版本。");
  if (
    !Array.isArray(value.categories) ||
    value.categories.length !== defaultCategories.length
  )
    return fail("预算类目不完整。");
  const allowedCategories = new Set(defaultCategories.map((c) => c.id));
  const categoryIds = new Set<string>();
  const categories = value.categories.map((item): Category => {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !allowedCategories.has(item.id) ||
      categoryIds.has(item.id)
    )
      return fail("预算类目重复或不受支持。");
    categoryIds.add(item.id);
    const average = (number: unknown): number | null => {
      if (number === null) return null;
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        Math.abs(number) > Number.MAX_SAFE_INTEGER / 100
      )
        return fail("历史参考金额格式不正确。");
      return number;
    };
    return {
      id: item.id,
      name: text(item.name, "类目名称", true),
      shortName: text(item.shortName, "类目简称", true),
      icon: text(item.icon, "类目图标"),
      tone: text(item.tone, "类目样式"),
      monthly: nonnegative(item.monthly, "月度预留"),
      bonus: nonnegative(item.bonus, "奖金补充"),
      annual: nonnegative(item.annual, "年度预算"),
      history16: average(item.history16),
      recent4: average(item.recent4),
    };
  });
  if (!record(value.settings)) return fail("缺少预算设置。");
  const settings: Settings = {
    startMonth: month(value.settings.startMonth, "预算起始月份"),
    asOf: date(value.settings.asOf, "查看截至日期"),
    rollover: bool(value.settings.rollover, "季度结转设置"),
    monthlyIncome: nonnegative(value.settings.monthlyIncome, "普通工资"),
    savingsGoal: nonnegative(value.settings.savingsGoal, "储蓄目标"),
    installments: nonnegative(value.settings.installments, "分期预留"),
  };
  if (!Array.isArray(value.transactions) || value.transactions.length > 100000)
    return fail("交易明细缺失或超过 100,000 笔。");
  const transactionIds = new Set<string>();
  const kinds = new Set([
    "expense",
    "refund",
    "income",
    "transfer",
    "repayment",
  ]);
  const transactions = value.transactions.map((item): Transaction => {
    if (!record(item)) return fail("交易明细格式不正确。");
    const id = text(item.id, "交易编号", true);
    if (transactionIds.has(id)) return fail("交易编号重复，请先去重。");
    transactionIds.add(id);
    if (typeof item.kind !== "string" || !kinds.has(item.kind))
      return fail("交易性质不受支持。");
    const kind = item.kind as Transaction["kind"];
    const amount = integer(item.amount, "交易金额（分）", true);
    if (kind === "refund" ? amount > 0 : amount < 0)
      return fail("交易金额正负方向不正确。");
    const categoryId = text(item.categoryId, "交易类目", true);
    if (!allowedCategories.has(categoryId) && categoryId !== "uncategorized")
      return fail("交易含有不受支持的消费类目。");
    const result: Transaction = {
      id,
      date: date(item.date, "交易日期"),
      merchant: text(item.merchant, "商户"),
      description: text(item.description, "交易说明"),
      amount,
      categoryId,
      kind,
      review: bool(item.review, "交易核对状态"),
      source: text(item.source, "交易渠道"),
    };
    if (item.excluded !== undefined)
      result.excluded = bool(item.excluded, "交易排除状态");
    for (const key of ["externalId", "originalId", "note"] as const) {
      if (item[key] !== undefined)
        result[key] = text(item[key], "交易附加说明");
    }
    return result;
  });
  const batchValue = value.batches === undefined ? [] : value.batches;
  if (!Array.isArray(batchValue) || batchValue.length > 100000)
    return fail("导入批次格式不正确。");
  const batchIds = new Set<string>();
  const batches = batchValue.map((item): SnapshotBatch => {
    if (!record(item)) return fail("导入批次格式不正确。");
    const id = text(item.id, "批次编号", true);
    if (batchIds.has(id)) return fail("导入批次编号重复。");
    batchIds.add(id);
    if (
      !Array.isArray(item.transactionIds) ||
      item.transactionIds.length > 100000
    )
      return fail("导入批次交易列表不正确。");
    return {
      id,
      name: text(item.name, "批次名称"),
      date: date(item.date, "批次日期"),
      count: integer(item.count, "批次笔数"),
      duplicates: integer(item.duplicates, "重复交易笔数"),
      transactionIds: item.transactionIds.map((entry) =>
        text(entry, "批次交易编号", true),
      ),
    };
  });
  const rawMetadata = value.metadata === undefined ? {} : value.metadata;
  if (!record(rawMetadata)) return fail("账本附加信息格式不正确。");
  const metadata = jsonCopy(rawMetadata) as BudgetSnapshot["metadata"];
  if (metadata?.latestDate !== undefined)
    date(metadata.latestDate, "账单覆盖截至日期");
  return {
    version: 1,
    categories,
    settings,
    transactions,
    batches,
    funds: amounts(value.funds, "专项资金"),
    saved: amounts(value.saved, "月度储蓄记录", true),
    metadata,
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

/** Stable content identity, independent of local private-entry bookkeeping. */
export async function snapshotFingerprint(
  snapshot: BudgetSnapshot,
): Promise<string> {
  const metadata = { ...snapshot.metadata };
  delete metadata.privateSnapshotId;
  delete metadata.privateLoadedAt;
  delete metadata.privateSource;
  const encoded = new TextEncoder().encode(
    JSON.stringify(canonical({ ...snapshot, metadata })),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
