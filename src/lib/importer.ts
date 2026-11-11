import * as XLSX from "xlsx";
import { defaultCategories, inferCategory, type Transaction } from "./model";

type Cell = string | number | Date | boolean | null | undefined;
type Row = Cell[];
export type ImportResult = {
  transactions: Transaction[];
  warnings: string[];
  source: string;
};
export type DeduplicateResult = {
  newTransactions: Transaction[];
  duplicates: number;
  conflicts: Transaction[];
  warnings: string[];
};

const clean = (value: Cell) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
const headerKey = (value: Cell) =>
  clean(value)
    .replace(/[\s（）()]/g, "")
    .toLowerCase();
const hash = (value: string) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++)
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/** RFC4180 quoting, embedded commas/newlines and optional tab separated statements. */
export function parseDelimited(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const firstLines = text.split(/\r?\n/).slice(0, 60);
  const tabHeader = firstLines.some(
    (l) =>
      /日期|交易时间|date/i.test(l) &&
      /金额|amount/i.test(l) &&
      l.includes("\t") &&
      !l.includes(","),
  );
  const separator = tabHeader ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field.length === 0) quoted = !quoted;
      else field += c;
    } else if (c === separator && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((s) => s.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合，请重新导出完整账单。");
  row.push(field);
  if (row.some((s) => s.trim())) rows.push(row);
  return rows;
}

const aliases = {
  date: ["交易时间", "交易日期", "记账日期", "日期", "date", "datetime"],
  amount: ["金额", "金额元", "交易金额", "amount", "支出金额"],
  merchant: ["交易对方", "对方户名", "商户", "商户名称", "merchant", "收款方"],
  description: ["商品说明", "商品", "说明", "摘要", "用途", "description"],
  flow: [
    "收/支",
    "收支",
    "收支类型",
    "收支方向",
    "借贷标志",
    "kind",
    "direction",
  ],
  status: ["交易状态", "当前状态", "状态", "status"],
  category: ["类目", "分类", "category", "categoryid"],
  platformCategory: ["交易分类", "交易类型"],
  externalId: [
    "交易订单号",
    "交易单号",
    "交易号",
    "流水号",
    "交易流水号",
    "externalid",
  ],
  originalId: ["原交易号", "原订单号", "originalid"],
  platform: ["平台", "渠道", "source", "platform"],
  notes: ["备注", "note"],
};

function getColumns(header: Row) {
  const keys = header.map(headerKey);
  return Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [
      key,
      keys.findIndex((k) => names.map(headerKey).includes(k)),
    ]),
  ) as Record<keyof typeof aliases, number>;
}

function parseDate(value: Cell): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 30000 && value < 100000) {
    const d = XLSX.SSF.parse_date_code(value);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const t = clean(value)
    .replace(/[年月/.]/g, "-")
    .replace(/日/g, "");
  const match = t.match(/^(\d{4})-?(\d{1,2})-?(\d{1,2})(?:\s|T|$)/);
  if (!match) return null;
  const y = Number(match[1]),
    m = Number(match[2]),
    d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  )
    return null;
  return `${match[1]}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseAmount(value: Cell): number | null {
  let raw = clean(value).replace(/[¥￥,，\s元]/g, "");
  if (/^\(.*\)$/.test(raw)) raw = `-${raw.slice(1, -1)}`;
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const n = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(n) ? n : null;
}

function explicitCategory(value: string): string | null {
  const found = defaultCategories.find(
    (c) => c.id === value || c.name === value || c.shortName === value,
  );
  if (found) return found.id;
  const names: Record<string, string> = {
    服饰鞋包: "clothing",
    美妆护肤洗护: "beauty",
    居住成本: "rent",
    餐饮消费: "food",
    交通出行: "transport",
    旅游消费: "travel",
    健康医疗: "health",
    学习成长: "learning",
    人情社交: "gifts",
    赠礼人情社交: "gifts",
    订阅服务: "subscriptions",
    水电通信: "utilities",
    娱乐摄影演出: "leisure",
    家居数码及购买附加费: "home",
    其他消费: "buffer",
  };
  return names[value] || null;
}

export function rowsToTransactions(
  rows: Row[],
  filename = "导入账单",
): ImportResult {
  const headerIndex = rows.findIndex((row) => {
    const c = getColumns(row);
    return c.date >= 0 && c.amount >= 0;
  });
  if (headerIndex < 0)
    throw new Error(
      "没有找到日期和金额列。请导入微信 XLSX、支付宝 CSV，或下载通用模板填写。",
    );
  const columns = getColumns(rows[headerIndex]);
  const preamble = rows
    .slice(0, headerIndex + 1)
    .map((r) => r.map(clean).join(" "))
    .join(" ");
  const source = /支付宝/.test(preamble + filename)
    ? "支付宝"
    : /微信/.test(preamble + filename)
      ? "微信"
      : /银行|银行流水|招行|农行|工行/.test(preamble + filename)
        ? "银行"
        : "通用账单";
  const transactions: Transaction[] = [],
    warnings: string[] = [];
  let invalid = 0,
    closed = 0,
    refundPending = 0,
    zero = 0;
  const occurrences = new Map<string, number>();
  for (const row of rows.slice(headerIndex + 1)) {
    const read = (key: keyof typeof aliases) =>
      columns[key] >= 0 ? row[columns[key]] : "";
    const date = parseDate(read("date"));
    if (!date) {
      if (clean(read("date")) && /\d{4}/.test(clean(read("date")))) invalid++;
      continue;
    }
    const parsedAmount = parseAmount(read("amount"));
    if (parsedAmount == null) {
      invalid++;
      continue;
    }
    if (parsedAmount === 0) {
      zero++;
      continue;
    }
    const status = clean(read("status"));
    if (
      /交易关闭|支付失败|交易失败|已撤销|已取消|未支付|等待付款|待付款/.test(
        status,
      )
    ) {
      closed++;
      continue;
    }
    const merchant = clean(read("merchant")) || "未填写商户";
    const description =
      clean(read("description")) ||
      clean(read("platformCategory")) ||
      "未填写用途";
    const platformCategory = clean(read("platformCategory"));
    const flow = clean(read("flow"));
    const externalId = clean(read("externalId")).replace(/^['\t]/, "");
    const rowSource = clean(read("platform")) || source;
    const words = `${platformCategory} ${description} ${merchant}`;
    const inferred = inferCategory(words);
    const categoryId =
      explicitCategory(clean(read("category"))) || inferred.categoryId;
    let kind: Transaction["kind"] = "expense";
    let review = !explicitCategory(clean(read("category"))) && inferred.review;
    let excluded = false;
    let originalId = clean(read("originalId"));
    let note = clean(read("notes"));
    const isRefund =
      /^(refund|退款)$/.test(flow) ||
      /退款成功|退还成功/.test(status) ||
      /^(退款|退款-|退货退款)/.test(platformCategory + description) ||
      /退款$/.test(platformCategory) ||
      (/^(income|收入|收|贷)$/.test(flow) && /退款/.test(status));
    if (isRefund) {
      kind = "refund";
      review = true;
      if (!originalId && rowSource === "支付宝" && externalId.includes("_"))
        originalId = externalId.split("_")[0];
      note = `${note} 退款需关联原消费，确认后才回补预算。`.trim();
      refundPending++;
    } else if (
      /^(repayment|还款)$/.test(flow) ||
      /信用卡还款|花呗还款|借呗还款|贷款还款|还贷款|分期还款|个贷交易/.test(
        words,
      )
    ) {
      kind = "repayment";
      review = false;
      excluded = true;
      note = `${note} 还本不重复计入消费。`.trim();
    } else if (flow === "income" || /^(收入|收|贷)$/.test(flow)) {
      kind = "income";
      review = false;
      excluded = true;
    } else if (
      /^(transfer|调拨|账户转账)$/.test(flow) ||
      /余额宝转入|余额宝转出|零钱通|提现|充值到余额|银行账户转账|本人调拨/.test(
        words,
      )
    ) {
      kind = "transfer";
      review = false;
      excluded = true;
    } else if (
      /^转账$|^群收款$|红包/.test(platformCategory) ||
      /^(不计收支|中性交易|\/)$/.test(flow)
    ) {
      // Peer-to-peer payments may be gifts or shared costs, so do not silently discard them.
      kind = "expense";
      review = true;
      note = `${note} 请确认是本人消费、AA 付款还是账户往来。`.trim();
    }
    if (kind === "expense" && /退款|退货/.test(status)) {
      review = true;
      note = `${note} 原单标记退款，待核对净承担金额。`.trim();
    }
    if (
      kind === "expense" &&
      source === "银行" &&
      !explicitCategory(clean(read("category")))
    ) {
      review = true;
      note = `${note} 银行扣款需排查是否已在支付账单中计入。`.trim();
    }
    // Generic negative amounts require review unless explicitly declared a refund.
    if (parsedAmount < 0 && kind === "expense") {
      review = true;
      note = `${note} 负金额方向待确认；暂按支出绝对值预留。`.trim();
    }
    const signedAmount =
      kind === "refund" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);
    const fallback = `${rowSource}|${clean(read("date"))}|${merchant}|${description}|${signedAmount}|${kind}`;
    const ordinal = occurrences.get(fallback) || 0;
    occurrences.set(fallback, ordinal + 1);
    const id = `import:${hash(externalId ? `${rowSource}|${externalId}` : `${fallback}|${ordinal}`)}`;
    transactions.push({
      id,
      date,
      merchant,
      description,
      amount: signedAmount,
      categoryId,
      kind,
      review,
      source: rowSource,
      ...(externalId ? { externalId } : {}),
      ...(originalId ? { originalId } : {}),
      excluded,
      ...(note ? { note } : {}),
    });
  }
  if (invalid) warnings.push(`${invalid} 行日期或金额格式无效，未导入。`);
  if (closed) warnings.push(`${closed} 笔失败、关闭或未支付订单已跳过。`);
  if (zero) warnings.push(`${zero} 笔零金额记录已跳过，不影响消费预算。`);
  if (refundPending)
    warnings.push(
      `${refundPending} 笔退款需与原单核对；未确认的退款不会增加可用预算。`,
    );
  if (source === "银行")
    warnings.push(
      "银行账单可能包含微信、支付宝扣款。请在待确认中排除重复流水。",
    );
  if (!transactions.length)
    throw new Error("账单中没有可读取的有效交易。请检查文件内容。");
  if (transactions.length > 50000)
    throw new Error("单次账单超过 50,000 笔，请按月分批导入。");
  return { transactions: reconcileRefunds(transactions), warnings, source };
}

function reconcileRefunds(
  transactions: Transaction[],
  previous: Transaction[] = [],
): Transaction[] {
  const originals = new Map<string, Transaction>();
  // Existing audited records win over a reimport of the same gross original order.
  for (const t of [...transactions, ...previous])
    if (t.kind === "expense" && t.externalId)
      originals.set(`${t.source}|${t.externalId}`, t);
  const refundSums = new Map<string, number>();
  const refundIds = new Set<string>();
  for (const t of [...previous, ...transactions])
    if (
      t.kind === "refund" &&
      t.originalId &&
      !t.excluded &&
      !refundIds.has(t.id)
    ) {
      refundIds.add(t.id);
      const key = `${t.source}|${t.originalId}`;
      refundSums.set(key, (refundSums.get(key) || 0) + Math.abs(t.amount));
    }
  return transactions.map((t) => {
    if (t.kind !== "refund" || !t.originalId) return t;
    const original = originals.get(`${t.source}|${t.originalId}`);
    if (!original) return t;
    if (/历史净额/.test(original.note || ""))
      return {
        ...t,
        review: true,
        note: `${t.note || ""} 原订单已按历史净额计入，需核对本次退款是否已经抵扣。`,
      };
    if ((refundSums.get(`${t.source}|${t.originalId}`) || 0) > original.amount)
      return {
        ...t,
        review: true,
        note: `${t.note || ""} 累计退款大于原单净额，需核对。`,
      };
    // Date is attributed to original purchase period; keep refund actual date in the note.
    return {
      ...t,
      date: original.date,
      categoryId: original.categoryId,
      review: original.review,
      note: `退款到账日 ${t.date}；已按交易号关联原消费。${original.review ? "原消费分类仍待确认。" : ""}`,
    };
  });
}

export async function parseBill(file: File): Promise<ImportResult> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("文件超过 25 MB，请按月拆分后导入。");
  if (/\.pdf$/i.test(file.name))
    throw new Error(
      "暂不直接读取 PDF。请使用银行 CSV / Excel 明细，或通用模板。",
    );
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (
    /\.xlsx?$/i.test(file.name) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    (bytes[0] === 0xd0 && bytes[1] === 0xcf)
  ) {
    const book = XLSX.read(buffer, { type: "array", cellDates: true });
    for (const sheetName of book.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<Row>(book.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: "",
      });
      const valid = rows.some((row) => {
        const cols = getColumns(row);
        return cols.date >= 0 && cols.amount >= 0;
      });
      if (valid) return rowsToTransactions(rows, file.name);
    }
    throw new Error("Excel 中没有找到日期、金额表头。支持微信账单或通用模板。");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("gb18030").decode(buffer);
  }
  return rowsToTransactions(parseDelimited(text), file.name);
}

export function deduplicate(
  existing: Transaction[],
  incoming: Transaction[],
): DeduplicateResult {
  const knownIds = new Set(existing.map((t) => t.id));
  const sourceKey = (t: Transaction) =>
    t.externalId ? `${t.source}|${t.externalId}` : "";
  const external = new Map(
    existing.filter((t) => t.externalId).map((t) => [sourceKey(t), t]),
  );
  const newTransactions: Transaction[] = [],
    conflicts: Transaction[] = [],
    warnings: string[] = [];
  let duplicates = 0,
    changed = 0;
  const candidates = reconcileRefunds(incoming, existing);
  for (const original of candidates) {
    let t = { ...original };
    const seen = external.get(sourceKey(t));
    if (knownIds.has(t.id) || (t.externalId && seen)) {
      duplicates++;
      if (seen && seen.amount !== t.amount) changed++;
      continue;
    }
    const potential = [...existing, ...newTransactions].find(
      (e) =>
        !e.excluded &&
        !e.review &&
        e.kind === "expense" &&
        t.kind === "expense" &&
        e.source !== t.source &&
        e.date === t.date &&
        e.amount === t.amount &&
        (e.merchant === t.merchant ||
          /银行|招行|农行|工行/.test(e.source + t.source)),
    );
    if (potential) {
      t = {
        ...t,
        review: true,
        note: `${t.note || ""} 与 ${potential.source} 同日同额消费可能重复，请核对后决定是否计入。`.trim(),
      };
      conflicts.push(t);
    }
    knownIds.add(t.id);
    if (t.externalId) external.set(sourceKey(t), t);
    newTransactions.push(t);
  }
  if (duplicates) warnings.push(`${duplicates} 笔已存在交易已跳过。`);
  if (changed)
    warnings.push(
      `${changed} 笔同订单金额与已有记录不同，保留已有净额；请核对退款或 AA 调整。`,
    );
  if (conflicts.length)
    warnings.push(`${conflicts.length} 笔跨平台疑似重复已放入待确认。`);
  return { newTransactions, duplicates, conflicts, warnings };
}

export const csvTemplate =
  "\uFEFF日期,商户,说明,金额,类目,收支类型,交易号,原交易号,平台\r\n";
