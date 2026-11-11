import { defaultCategories, type Transaction } from "./model";

export type TransactionValidationOptions = {
  acknowledgeHistoricalNet?: boolean;
};

const validDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

function refersTo(refund: Transaction, original: Transaction): boolean {
  return (
    refund.originalId === original.id ||
    (!!original.externalId &&
      refund.originalId === original.externalId &&
      refund.source === original.source)
  );
}

/** Validate manual edits before they affect balances. Throws a user-facing Chinese error. */
export function validateAndNormalizeTransaction(
  candidate: Transaction,
  existing: Transaction[],
  options: TransactionValidationOptions = {},
): Transaction {
  if (!candidate || !candidate.id?.trim())
    throw new Error("记录缺少交易标识，请重新打开编辑窗口。");
  if (!validDate(candidate.date))
    throw new Error("请输入有效日期，例如 2026-11-11。");
  if (!Number.isSafeInteger(candidate.amount) || candidate.amount === 0)
    throw new Error("金额必须大于 0，最多保留两位小数。");
  if (
    !["expense", "refund", "income", "transfer", "repayment"].includes(
      candidate.kind,
    )
  )
    throw new Error("请选择有效的收支类型。");
  const amount = Math.abs(candidate.amount);
  const result: Transaction = {
    ...candidate,
    merchant: candidate.merchant.trim() || "未填写商户",
    description: candidate.description.trim() || "未填写用途",
  };
  const priorExpense = existing.find(
    (t) => t.id === candidate.id && t.kind === "expense",
  );
  if (
    candidate.kind !== "expense" &&
    priorExpense &&
    existing.some(
      (t) =>
        t.kind === "refund" &&
        !t.review &&
        !t.excluded &&
        refersTo(t, priorExpense),
    )
  ) {
    throw new Error(
      "该消费已关联退款。请先将相关退款改为待确认，再把原单改为非消费或退款。",
    );
  }
  if (
    candidate.kind === "income" ||
    candidate.kind === "transfer" ||
    candidate.kind === "repayment"
  ) {
    return { ...result, amount, excluded: true, review: false };
  }
  result.excluded = false;
  result.amount = candidate.kind === "refund" ? -amount : amount;
  if (
    !candidate.review &&
    candidate.kind === "expense" &&
    !defaultCategories.some((c) => c.id === candidate.categoryId)
  ) {
    throw new Error("请为已确认的消费选择具体类目；用途不明时保留“待确认”。");
  }
  if (candidate.kind === "expense") {
    const prior = existing.find((t) => t.id === candidate.id);
    const linked = existing.filter(
      (t) =>
        t.id !== candidate.id &&
        t.kind === "refund" &&
        !t.review &&
        !t.excluded &&
        refersTo(t, prior || result),
    );
    if (linked.reduce((s, t) => s + Math.abs(t.amount), 0) > amount)
      throw new Error("该消费已有退款，修改后的金额不能小于已确认退款合计。");
    if (
      linked.length &&
      (result.review ||
        linked.some(
          (t) => t.date !== result.date || t.categoryId !== result.categoryId,
        ))
    ) {
      throw new Error(
        "该消费已关联退款。请先将相关退款改为待确认，再调整原单日期、类目或确认状态。",
      );
    }
    return result;
  }
  if (candidate.review) return result;
  if (!candidate.originalId?.trim())
    throw new Error("确认退款前，请选择对应的原消费。");
  const exactOriginal = existing.find(
    (t) =>
      t.id === candidate.originalId &&
      t.id !== candidate.id &&
      t.kind === "expense",
  );
  const externalMatches = existing.filter(
    (t) =>
      t.externalId === candidate.originalId &&
      t.id !== candidate.id &&
      t.kind === "expense",
  );
  const original =
    exactOriginal ||
    (externalMatches.length === 1
      ? externalMatches[0]
      : externalMatches.find((t) => t.source === candidate.source));
  if (!original)
    throw new Error("未找到唯一的原消费，请先导入或选择正确原单。");
  if (original.excluded || original.amount <= 0)
    throw new Error("该原单已排除或净额为零，无法再次回补预算。");
  if (
    original.review ||
    !defaultCategories.some((c) => c.id === original.categoryId)
  )
    throw new Error("请先确认原消费的用途与类目，再确认退款。");
  const historyNet = /历史净额/.test(original.note || "");
  if (historyNet && !options.acknowledgeHistoricalNet)
    throw new Error(
      "原消费已按历史净额计入。请确认此次退款尚未抵扣，避免重复回补预算。",
    );
  const linked = existing.filter(
    (t) =>
      t.id !== candidate.id &&
      t.kind === "refund" &&
      !t.review &&
      !t.excluded &&
      refersTo(t, original),
  );
  const refunded = linked.reduce((s, t) => s + Math.abs(t.amount), 0);
  if (refunded + amount > original.amount)
    throw new Error(
      `累计退款超出原消费可抵扣净额；本次最多可确认 ¥${((original.amount - refunded) / 100).toFixed(2)}。`,
    );
  return {
    ...result,
    originalId: original.id,
    source: original.source,
    categoryId: original.categoryId,
    date: original.date,
    note: [
      candidate.note,
      `退款按原消费 ${original.date} 归属；编辑时退款日期 ${candidate.date}。`,
      historyNet ? "已人工确认本次退款未在历史净额中抵扣。" : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** Prevent removing an original while retaining a confirmed budget-crediting refund. */
export function validateTransactionExclusion(
  transaction: Transaction,
  existing: Transaction[],
): void {
  if (
    transaction.kind === "expense" &&
    existing.some(
      (t) =>
        t.kind === "refund" &&
        !t.review &&
        !t.excluded &&
        refersTo(t, transaction),
    )
  ) {
    throw new Error(
      "该消费已关联退款。请先排除或撤销确认相关退款，再排除原消费。",
    );
  }
}

/** Undo only a batch's records; orphaned refunds lose confirmation, not their audit history. */
export function removeBatchTransactions(
  existing: Transaction[],
  ids: string[],
): Transaction[] {
  const removedIds = new Set(ids);
  const removedOriginals = existing.filter(
    (t) => removedIds.has(t.id) && t.kind === "expense",
  );
  return existing
    .filter((t) => !removedIds.has(t.id))
    .map((t) => {
      if (
        t.kind !== "refund" ||
        !removedOriginals.some((original) => refersTo(t, original))
      ) {
        return t;
      }
      return {
        ...t,
        review: true,
        note: [
          t.note,
          "关联原消费已随导入批次撤销；请重新关联并确认，当前退款不回补预算。",
        ]
          .filter(Boolean)
          .join(" "),
      };
    });
}
