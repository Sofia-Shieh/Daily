import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Coffee,
  CreditCard,
  Download,
  Dumbbell,
  Gift,
  Heart,
  House,
  LayoutGrid,
  ListFilter,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Ticket,
  TrainFront,
  Trash2,
  Upload,
  Wallet,
  X,
  CalendarDays,
  BookOpen,
  Plane,
  Smartphone,
  SlidersHorizontal,
  AlertCircle,
  FileSpreadsheet,
  RotateCcw,
  Pencil,
  Coins,
  CheckCircle2,
} from "lucide-react";
import {
  computeBudget,
  defaultCategories,
  defaultSettings,
  type Category,
  type Settings,
  type Transaction,
} from "./lib/model";

type Page = "overview" | "transactions" | "import" | "settings";
import {
  validateAndNormalizeTransaction,
  validateTransactionExclusion,
  removeBatchTransactions,
} from "./lib/editor";

import { fetchVault, parseVaultKey } from "./lib/vault";
import {
  parseSnapshot,
  snapshotFingerprint,
  type BudgetSnapshot,
} from "./lib/snapshot";
type State = BudgetSnapshot;
// A fragment is never sent in HTTP requests. Remove it before any vault fetch.
const entryHash = window.location.hash;
const initialVaultKey = parseVaultKey(entryHash);
const invalidVaultEntry = entryHash.startsWith("#vault=") && !initialVaultKey;
if (entryHash.startsWith("#vault=")) {
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
}
const STORAGE = "daily-budget-v1";
function historyRangeLabel(metadata: State["metadata"]) {
  const range = (key: string) => {
    const value = metadata?.[key] as
      | { startDate?: string; endDate?: string }
      | undefined;
    return value?.startDate && value?.endDate
      ? `${value.startDate.slice(0, 7)} — ${value.endDate.slice(0, 7)}`
      : "未载入参考数据";
  };
  return `历史均值区间：${range("history16")}；近期均值区间：${range("recent4")}。`;
}

const money = (cents: number, decimals = 0) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(cents / 100);
const yuan = (n: number) => money(Math.round(n * 100));
const displayDate = (d: string) => d.replaceAll("-", ".");
const keyMonth = (d: string) => d.slice(0, 7);
const emptyState = (): State => ({
  version: 1,
  categories: defaultCategories,
  settings: defaultSettings,
  transactions: [],
  batches: [],
  funds: {},
  saved: {},
});
const readState = () => {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE) || "null");
    return v?.version === 1 &&
      Array.isArray(v.transactions) &&
      Array.isArray(v.categories)
      ? (v as State)
      : null;
  } catch {
    return null;
  }
};
const download = (text: string, name: string, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function Icon({
  name,
  size = 20,
  ...rest
}: {
  name: string;
  size?: number;
  [key: string]: unknown;
}) {
  const map: Record<string, typeof House> = {
    rent: House,
    home: House,
    food: Coffee,
    dining: Coffee,
    transport: TrainFront,
    clothing: ShoppingBag,
    beauty: Sparkles,
    household: House,
    digital: Smartphone,
    gym: Dumbbell,
    fitness: Dumbbell,
    leisure: Ticket,
    entertainment: Ticket,
    health: Heart,
    medical: Heart,
    learning: BookOpen,
    gifts: Gift,
    social: Gift,
    subscriptions: Smartphone,
    subscription: Smartphone,
    utilities: Wallet,
    travel: Plane,
    buffer: Coins,
    other: Coins,
    uncategorized: CircleHelp,
  };
  const C = map[name] || ShoppingBag;
  return <C size={size} strokeWidth={1.65} {...rest} />;
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = before;
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <button
          className="icon-button close"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={22} />
        </button>
        <div className="eyebrow">A LITTLE MORE CLARITY</div>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>(() => readState() || emptyState());
  const [ready, setReady] = useState(
    !!readState() || !import.meta.env.DEV || entryHash.startsWith("#vault="),
  );
  const [page, setPage] = useState<Page>("overview");
  const [period, setPeriod] = useState<"quarter" | "year">("quarter");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [ledgerCategory, setLedgerCategory] = useState("all");
  const [ledgerMonth, setLedgerMonth] = useState("all");
  const [rowLimit, setRowLimit] = useState(40);
  const [toast, setToast] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [edit, setEdit] = useState<Transaction | null>(null);
  const [calculator, setCalculator] = useState(false);
  const [calcCategory, setCalcCategory] = useState("clothing");
  const [calcAmount, setCalcAmount] = useState("");
  const [modal, setModal] = useState<"help" | "saving" | null>(null);
  const [preview, setPreview] = useState<{
    transactions: Transaction[];
    warnings: string[];
    names: string;
    duplicates: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [draftCategories, setDraftCategories] = useState<Category[]>(
    state.categories,
  );
  const [draftSettings, setDraftSettings] = useState<Settings>(state.settings);
  const [saveAmount, setSaveAmount] = useState(
    String(state.settings.savingsGoal),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [vaultKey, setVaultKey] = useState<string | null>(initialVaultKey);
  const [vaultBusy, setVaultBusy] = useState(!!initialVaultKey);
  const [vaultError, setVaultError] = useState(
    invalidVaultEntry ? "专属入口不完整，请重新打开完整链接。" : "",
  );
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockInput, setUnlockInput] = useState("");
  const [vaultIncoming, setVaultIncoming] = useState<{
    snapshot: State;
    fingerprint: string;
  } | null>(null);
  const vaultFlight = useRef<{ key: string; promise: Promise<unknown> } | null>(
    null,
  );
  const installSnapshot = (snapshot: State, fingerprint: string) => {
    const next: State = {
      ...snapshot,
      settings: { ...snapshot.settings, asOf: defaultSettings.asOf },
      metadata: {
        ...snapshot.metadata,
        privateSnapshotId: fingerprint,
        privateLoadedAt: new Date().toISOString(),
      },
    };
    // Persist before reporting success; do not replace an existing book on a failed write.
    localStorage.setItem(STORAGE, JSON.stringify(next));
    setState(next);
    setDraftCategories(next.categories);
    setDraftSettings(next.settings);
    setSaveAmount(String(next.settings.savingsGoal));
    setReady(true);
    setVaultIncoming(null);
    setUnlockOpen(false);
    setUnlockInput("");
    setVaultError("");
    notify("已载入已核对账单和个人预算");
  };

  const notify = (s: string) => {
    setToast(s);
  };
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const receivePrivateEntry = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#vault=")) return;
      const key = parseVaultKey(hash);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
      if (key) {
        setVaultError("");
        setVaultKey(key);
      } else {
        setVaultError("专属入口不完整，请重新打开完整链接。");
      }
    };
    window.addEventListener("hashchange", receivePrivateEntry);
    return () => window.removeEventListener("hashchange", receivePrivateEntry);
  }, []);
  useEffect(() => {
    if (!vaultKey) return;
    let cancelled = false;
    setVaultBusy(true);
    setVaultError("");
    if (vaultFlight.current?.key !== vaultKey) {
      vaultFlight.current = {
        key: vaultKey,
        promise: fetchVault(vaultKey, {
          url: `${import.meta.env.BASE_URL}private-vault.json`,
        }),
      };
    }
    const flight = vaultFlight.current;
    flight.promise
      .then(async (value) => {
        const snapshot = parseSnapshot(value);
        const fingerprint = await snapshotFingerprint(snapshot);
        if (cancelled) return;
        const existing = readState();
        if (existing?.metadata?.privateSnapshotId === fingerprint) {
          setState(existing);
          setReady(true);
          setUnlockOpen(false);
          setUnlockInput("");
          notify("已使用本机账本，后续新增记录和修改已保留");
        } else if (
          existing &&
          (existing.transactions.length > 0 ||
            existing.categories.some((c) => c.annual > 0) ||
            Object.values(existing.saved || {}).some((v) => v > 0) ||
            Object.values(existing.funds || {}).some((v) => v > 0))
        ) {
          setVaultIncoming({ snapshot, fingerprint });
          setUnlockOpen(false);
          setUnlockInput("");
        } else {
          installSnapshot(snapshot, fingerprint);
        }
      })
      .catch((error) => {
        if (!cancelled)
          setVaultError(
            error instanceof Error
              ? error.message
              : "无法载入私密账本，请稍后重试。",
          );
      })
      .finally(() => {
        if (!cancelled) {
          vaultFlight.current = null;
          setVaultKey(null);
          setVaultBusy(false);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vaultKey]);
  useEffect(() => {
    if (ready || !import.meta.env.DEV) return;
    let cancelled = false;
    fetch("/api/local-history")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.transactions) {
          setState((s) => ({
            ...s,
            transactions: data.transactions,
            categories: data.categories || s.categories,
            settings: data.settings || s.settings,
            metadata: data.metadata,
            batches: [
              {
                id: "historical",
                name: "已整理的历史账单",
                date: data.metadata?.reviewedAsOf || defaultSettings.asOf,
                count: data.transactions.filter(
                  (t: Transaction) => !t.excluded && t.kind === "expense",
                ).length,
                duplicates: 0,
                transactionIds: [],
              },
            ],
          }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(state));
      } catch {
        notify("浏览器存储空间不足，请立即导出备份。");
      }
    }
  }, [state, ready]);
  const budget = useMemo(
    () => computeBudget(state.transactions, state.categories, state.settings),
    [state],
  );
  const categories = budget.categories;
  const month = keyMonth(state.settings.asOf);
  const currentPending = state.transactions.filter(
    (t) =>
      !t.excluded &&
      (t.review || !state.categories.some((c) => c.id === t.categoryId)) &&
      (t.kind === "expense" || t.kind === "refund") &&
      t.date >= budget.period.yearStart &&
      t.date <= state.settings.asOf,
  );
  const pendingTotal = currentPending
    .filter((t) => t.kind === "expense")
    .reduce((a, t) => a + t.amount, 0);
  const quarterPending = currentPending
    .filter((t) => t.kind === "expense" && t.date >= budget.period.quarterStart)
    .reduce((a, t) => a + t.amount, 0);
  const confirmYear = categories.reduce((a, c) => a + c.yearSpent, 0);
  const confirmQuarter = categories.reduce((a, c) => a + c.quarterSpent, 0);
  const yearRemaining =
    categories.reduce((a, c) => a + c.annualRemaining, 0) - pendingTotal;
  const quarterRemaining =
    categories.reduce((a, c) => a + c.quarterRemaining, 0) -
    (state.settings.rollover ? pendingTotal : quarterPending);
  const currentSpent = period === "quarter" ? confirmQuarter : confirmYear;
  const currentRemaining =
    period === "quarter" ? quarterRemaining : yearRemaining;
  const planned =
    period === "quarter"
      ? categories.reduce((a, c) => a + c.quarterAvailable, 0)
      : categories.reduce((a, c) => a + c.annualBudget, 0);
  const pending =
    period === "quarter" && !state.settings.rollover
      ? quarterPending
      : pendingTotal;
  const latestDate = state.transactions
    .filter((t) => !t.excluded)
    .map((t) => t.date)
    .sort()
    .at(-1);
  const totalTransactions = state.transactions.filter(
    (t) => !t.excluded && t.kind === "expense",
  ).length;
  const nav = (p: Page) => {
    if (p === "settings") {
      setDraftCategories(state.categories);
      setDraftSettings(state.settings);
    }
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const ordered = useMemo(() => {
    const preferred = ["clothing", "beauty", "food", "gifts", "travel", "home"];
    return [...categories].sort(
      (a, b) =>
        (preferred.includes(a.id)
          ? preferred.indexOf(a.id)
          : 100 + state.categories.findIndex((c) => c.id === a.id)) -
        (preferred.includes(b.id)
          ? preferred.indexOf(b.id)
          : 100 + state.categories.findIndex((c) => c.id === b.id)),
    );
  }, [categories, state.categories]);
  const visibleCategories = ordered.filter(
    (c) =>
      filter === "all" ||
      (filter === "focus"
        ? ["clothing", "beauty", "gifts", "travel"].includes(c.id)
        : (period === "quarter" ? c.quarterRemaining : c.annualRemaining) <
          (period === "quarter" ? c.quarterAvailable : c.annualBudget) * 0.2),
  );
  const ledger = useMemo(
    () =>
      state.transactions
        .filter(
          (t) =>
            (ledgerCategory === "excluded" ? !!t.excluded : !t.excluded) &&
            (ledgerCategory === "excluded"
              ? true
              : ledgerCategory === "review"
                ? t.review
                : ledgerCategory === "all"
                  ? t.kind === "expense" || t.kind === "refund"
                  : t.categoryId === ledgerCategory) &&
            (ledgerMonth === "all" || t.date.startsWith(ledgerMonth)) &&
            `${t.merchant} ${t.description} ${t.note || ""}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [state.transactions, ledgerCategory, ledgerMonth, query],
  );
  const monthOptions = [
    ...new Set(state.transactions.map((t) => t.date.slice(0, 7))),
  ]
    .sort()
    .reverse();
  const getCat = (id: string) => state.categories.find((c) => c.id === id);
  const openDetail = (id: string) => setDetail(id);
  const reviewTransactions = () => {
    setLedgerCategory("review");
    setLedgerMonth("all");
    setQuery("");
    nav("transactions");
  };
  const loadFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setImportError("");
    const tx: Transaction[] = [];
    const warnings: string[] = [];
    let duplicates = 0;
    try {
      const { parseBill, deduplicate } = await import("./lib/importer");
      for (const file of files) {
        const parsed = await parseBill(file);
        const result = deduplicate(
          [...state.transactions, ...tx],
          parsed.transactions,
        );
        tx.push(...result.newTransactions);
        duplicates += result.duplicates;
        warnings.push(...parsed.warnings, ...result.warnings);
        if (result.conflicts.length)
          warnings.push(
            `${file.name}：${result.conflicts.length} 笔可能跨渠道重复，已标为待确认。`,
          );
      }
      setPreview({
        transactions: tx,
        warnings: [...new Set(warnings)],
        names: files.map((f) => f.name).join("、"),
        duplicates,
      });
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : "读取失败，请检查文件格式。",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const commitImport = () => {
    if (!preview) return;
    const id = `batch-${Date.now()}`;
    setState((s) => ({
      ...s,
      transactions: [...s.transactions, ...preview.transactions],
      settings: {
        ...s.settings,
        asOf: preview.transactions.reduce(
          (latest, t) => (t.date > latest ? t.date : latest),
          s.settings.asOf,
        ),
      },
      batches: [
        {
          id,
          name: preview.names,
          date: new Date().toLocaleDateString("sv-SE", {
            timeZone: "Asia/Shanghai",
          }),
          count: preview.transactions.length,
          duplicates: preview.duplicates,
          transactionIds: preview.transactions.map((t) => t.id),
        },
        ...s.batches,
      ],
    }));
    notify(
      `已导入 ${preview.transactions.length} 笔，跳过 ${preview.duplicates} 笔重复记录`,
    );
    setPreview(null);
  };
  const backup = () =>
    download(
      JSON.stringify(
        { ...state, exportedAt: new Date().toISOString() },
        null,
        2,
      ),
      `留白预算备份-${state.settings.asOf}.json`,
    );
  const restore = async (file: File) => {
    try {
      const v = parseSnapshot(JSON.parse(await file.text()));
      if (
        !window.confirm(
          "恢复备份将替换当前浏览器中的账单和预算。建议先导出当前备份。继续恢复？",
        )
      )
        return;
      setState({
        ...v,
        funds: v.funds || {},
        saved: v.saved || {},
        batches: v.batches || [],
      });
      setDraftCategories(v.categories);
      setDraftSettings(v.settings);
      notify("备份已恢复");
    } catch (e) {
      notify(e instanceof Error ? e.message : "备份读取失败");
    }
    if (backupRef.current) backupRef.current.value = "";
  };
  const template = () =>
    download(
      "\uFEFF日期,商户,说明,金额,类目,收支类型,交易号,原交易号,平台\r\n",
      "账单导入模板.csv",
      "text/csv;charset=utf-8",
    );
  const handleSaveSettings = () => {
    if (
      draftCategories.some(
        (c) =>
          !Number.isFinite(c.monthly) ||
          !Number.isFinite(c.bonus) ||
          c.monthly < 0 ||
          c.bonus < 0,
      ) ||
      [
        draftSettings.monthlyIncome,
        draftSettings.savingsGoal,
        draftSettings.installments,
      ].some((n) => !Number.isFinite(n) || n < 0) ||
      !draftSettings.startMonth ||
      !draftSettings.asOf
    ) {
      notify("请填写有效的日期和非负预算金额");
      return;
    }
    setState((s) => ({
      ...s,
      categories: draftCategories.map((c) => ({
        ...c,
        annual: Math.round((c.monthly * 12 + c.bonus) * 100) / 100,
      })),
      settings: draftSettings,
    }));
    notify("预算已更新，余额已重新计算");
  };
  const saving = state.saved[month] || 0;
  const monthlyReserved = draftCategories.reduce((a, c) => a + c.monthly, 0);
  const wageGap =
    draftSettings.monthlyIncome -
    draftSettings.savingsGoal -
    draftSettings.installments -
    monthlyReserved;
  const selected = categories.find((c) => c.id === detail);
  const calc = categories.find((c) => c.id === calcCategory) || categories[0];
  const calcCents = Math.max(0, Math.round((Number(calcAmount) || 0) * 100));
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => nav("overview")}
          aria-label="留白首页"
        >
          <span className="brand-mark">
            d<span>.</span>
          </span>
          <span className="brand-cn">
            留白<span>DAILY BUDGET</span>
          </span>
        </button>
        <nav className="desktop-nav" aria-label="主导航">
          {(
            [
              ["overview", "预算总览"],
              ["transactions", "消费明细"],
              ["import", "账单导入"],
              ["settings", "预算设置"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => nav(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="local-status">
            <span />
            本机保存
          </span>
          <button
            className="avatar"
            aria-label="数据与使用说明"
            onClick={() => setModal("help")}
          >
            D
          </button>
        </div>
      </header>
      <main>
        {page === "overview" && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="tiny-dot" /> MY MONEY, MY PACE
                </div>
                <h1>
                  给喜欢的生活，<span>留一点余地。</span>
                </h1>
                <p>花得心里有数，也为明天留白。</p>
              </div>
              <button className="button dark" onClick={() => nav("import")}>
                <Plus size={17} />
                导入新账单
              </button>
            </section>
            {vaultBusy && (
              <div className="vault-status" role="status">
                <LoaderCircle size={18} className="spin" />
                <div>
                  <strong>正在载入你的已核对账本…</strong>
                  <span>完成后自动更新预算余额。</span>
                </div>
              </div>
            )}
            {vaultError && (
              <div className="alert error" role="alert">
                <AlertCircle size={18} />
                <span>{vaultError}</span>
                <button
                  className="text-button"
                  onClick={() => setUnlockOpen(true)}
                >
                  重新解锁
                </button>
              </div>
            )}
            {state.metadata?.privateSnapshotId && (
              <div className="vault-status loaded">
                <ShieldCheck size={18} />
                <div>
                  <strong>已载入你的财务分析数据</strong>
                  <span>
                    账单覆盖至 {String(state.metadata.latestDate || "待核对")} ·
                    后续导入保存在本机。
                  </span>
                </div>
              </div>
            )}
            {state.categories.every((c) => c.annual === 0) && (
              <section className="setup-card">
                <div>
                  <strong>从自己的生活账开始。</strong>
                  <p>
                    恢复已有账本，或设置预算再导入消费。你的数据仅保存在当前浏览器。
                  </p>
                </div>
                <div>
                  <button
                    className="button dark"
                    onClick={() => backupRef.current?.click()}
                  >
                    <Upload size={16} />
                    恢复我的账本
                  </button>
                  <button
                    className="text-button"
                    onClick={() => nav("settings")}
                  >
                    设置预算 <ArrowRight size={15} />
                  </button>
                </div>
              </section>
            )}
            <section className="hero-grid">
              <div className="balance-card">
                <div className="card-top">
                  <span className="label">
                    <span className="status-dot" />
                    {period === "quarter" ? "本季度" : "本预算年"}还可安排
                  </span>
                  <div className="segmented">
                    <button
                      className={period === "quarter" ? "selected" : ""}
                      onClick={() => setPeriod("quarter")}
                    >
                      季度
                    </button>
                    <button
                      className={period === "year" ? "selected" : ""}
                      onClick={() => setPeriod("year")}
                    >
                      年度
                    </button>
                  </div>
                </div>
                <div className="hero-amount">
                  <span>¥</span>
                  {money(currentRemaining, 2).split(".")[0]}
                  <span className="amount-decimal">
                    .{money(currentRemaining, 2).split(".")[1]}
                  </span>
                </div>
                <div className="period-caption">
                  {displayDate(
                    period === "quarter"
                      ? budget.period.quarterStart
                      : budget.period.yearStart,
                  )}{" "}
                  —{" "}
                  {displayDate(
                    period === "quarter"
                      ? budget.period.quarterEnd
                      : budget.period.yearEnd,
                  )}
                  <span> · 参考余额，非现金</span>
                </div>
                <div className="hero-progress">
                  <span
                    style={{
                      width: `${Math.min(100, Math.max(0, planned > 0 ? ((currentSpent + pending) / planned) * 100 : 0))}%`,
                    }}
                  />
                </div>
                <div className="hero-bottom">
                  <div>
                    <span>已确认消费</span>
                    <strong>¥ {money(currentSpent)}</strong>
                  </div>
                  <div>
                    <span>待确认占用</span>
                    <strong>¥ {money(pending)}</strong>
                  </div>
                  <div className="hero-total">
                    <span>
                      预算
                      {state.settings.rollover && period === "quarter"
                        ? "（含结转）"
                        : ""}
                    </span>
                    <strong>¥ {money(planned)}</strong>
                  </div>
                </div>
                <div className="receipt-art" aria-hidden="true">
                  <span className="receipt-hole" />
                  <div>
                    little joys
                    <br />
                    big plans.
                  </div>
                  <div className="receipt-lines" />
                  <span className="receipt-footer">MAKE ROOM FOR LIFE ↗</span>
                  <span className="receipt-check">✓</span>
                </div>
              </div>
              <div className="saving-card">
                <div className="card-top">
                  <span className="label">每月给未来的自己</span>
                  <ArrowUpRight size={20} />
                </div>
                <div className="saving-amount">
                  ¥ {yuan(state.settings.savingsGoal)}
                  <span>/ 月</span>
                </div>
                <p>普通工资储蓄目标 · 年终奖另行安排</p>
                <div className="note-paper" aria-hidden="true">
                  <span className="note-tape" />
                  <span className="note-star">✳</span>
                  <span className="note-words">
                    慢慢积累，
                    <br />
                    也好好生活。
                  </span>
                  <small>one month at a time</small>
                </div>
                <div className="saving-bottom">
                  <div>
                    <span className="small muted">
                      {month.replace("-", " 年 ")} 月已确认存入
                    </span>
                    <strong>¥ {money(saving)}</strong>
                  </div>
                  <button
                    className="circle-button"
                    aria-label="记录本月储蓄"
                    onClick={() => {
                      setSaveAmount(
                        String(saving / 100 || state.settings.savingsGoal),
                      );
                      setModal("saving");
                    }}
                  >
                    <Plus size={19} />
                  </button>
                </div>
              </div>
            </section>
            <div className="data-note">
              <span>
                <ShieldCheck size={15} />
                {ready
                  ? `基于 ${totalTransactions.toLocaleString()} 笔消费记录`
                  : "正在载入历史账单"}
                {latestDate && ` · 最新至 ${displayDate(latestDate)}`}
              </span>
              <button onClick={() => setModal("help")}>
                数据口径 <CircleHelp size={14} />
              </button>
            </div>
            <div className="coverage-note">
              <CircleHelp size={14} />
              <span>
                余额仅反映已录入的消费；请补齐房租、水电及其他渠道，未记录不代表未支出。
              </span>
              <button
                onClick={() => {
                  setLedgerCategory("all");
                  nav("transactions");
                }}
              >
                补充记录 <ArrowRight size={13} />
              </button>
            </div>
            <section className="budget-section">
              <div className="section-heading">
                <div>
                  <h2>
                    我的预算口袋{" "}
                    <span className="count-pill">{categories.length}</span>
                  </h2>
                  <p>按季度安排，按年度把握。集中采购也从容。</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setDraftCategories(state.categories);
                    setDraftSettings(state.settings);
                    nav("settings");
                  }}
                >
                  调整预算 <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="category-tools">
                <div className="filter-chips">
                  {[
                    ["all", "全部类目"],
                    ["focus", "集中采购"],
                    ["attention", "需要留意"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      className={filter === key ? "active" : ""}
                      onClick={() => setFilter(key)}
                    >
                      {key === "focus" && <ShoppingBag size={14} />} {label}
                    </button>
                  ))}
                </div>
                <label className="category-hint">
                  截至
                  <input
                    aria-label="预算查看截至日期"
                    type="date"
                    value={state.settings.asOf}
                    onChange={(e) => {
                      if (e.target.value) {
                        setState((s) => ({
                          ...s,
                          settings: { ...s.settings, asOf: e.target.value },
                        }));
                        setDraftSettings((s) => ({
                          ...s,
                          asOf: e.target.value,
                        }));
                      }
                    }}
                  />
                </label>
              </div>
              <div className="category-grid">
                {visibleCategories.map((c, index) => {
                  const remaining =
                    period === "quarter"
                      ? c.quarterRemaining
                      : c.annualRemaining;
                  const allocated =
                    period === "quarter" ? c.quarterAvailable : c.annualBudget;
                  const spent =
                    period === "quarter" ? c.quarterSpent : c.yearSpent;
                  const ratio = allocated > 0 ? spent / allocated : 0;
                  return (
                    <button
                      key={c.id}
                      className={`category-card ${remaining < 0 ? "over-budget" : ""}`}
                      onClick={() => openDetail(c.id)}
                      style={{ animationDelay: `${Math.min(index, 6) * 35}ms` }}
                    >
                      <div className="category-card-head">
                        <span className={`category-icon tone-${c.id}`}>
                          <Icon name={c.id} size={22} />
                        </span>
                        <span
                          className={`budget-status ${remaining < 0 ? "danger" : ratio > 0.8 ? "warm" : ""}`}
                        >
                          {remaining < 0
                            ? "已超预算"
                            : ratio > 0.8
                              ? "余量不多"
                              : "按自己的节奏"}
                        </span>
                        <ArrowUpRight className="category-arrow" size={17} />
                      </div>
                      <h3>{c.shortName || c.name}</h3>
                      <div className="category-balance">
                        <strong>¥ {money(remaining)}</strong>
                        <span>
                          {period === "quarter" ? "季度" : "年度"}剩余
                        </span>
                      </div>
                      <div className="mini-progress">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
                          }}
                        />
                      </div>
                      <div className="category-meta">
                        <span>已用 ¥ {money(spent)}</span>
                        <span>/ ¥ {money(allocated)}</span>
                      </div>
                      <div className="category-year">
                        <span>
                          {period === "quarter" ? "年度" : "季度"}剩余
                        </span>
                        <strong>
                          ¥{" "}
                          {money(
                            period === "quarter"
                              ? c.annualRemaining
                              : c.quarterRemaining,
                          )}
                        </strong>
                      </div>
                      {c.pendingCount > 0 && (
                        <span className="pending-mark">
                          {c.pendingCount} 笔待确认
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {!visibleCategories.length && (
                <div className="empty-small">
                  <CheckCircle2 />
                  当前没有接近预算上限的类目，继续保持自己的节奏。
                </div>
              )}
            </section>
            <section className="bottom-grid">
              <div className="check-card">
                <span className="mini-eyebrow">BEFORE YOU BUY</span>
                <h2>这次心动，预算放得下吗？</h2>
                <p>输入价格，看一看买完后还剩多少。</p>
                <button
                  className="button dark"
                  onClick={() => setCalculator(true)}
                >
                  消费前算一算 <ArrowUpRight size={16} />
                </button>
                <div className="bag-art" aria-hidden="true">
                  <span />
                  <i>
                    little
                    <br />
                    things.
                  </i>
                </div>
              </div>
              <div className="review-card">
                <div className="section-heading">
                  <h3>让账本更准确</h3>
                  <span className="icon-soft">
                    <ListFilter size={20} />
                  </span>
                </div>
                <p>
                  {currentPending.length
                    ? `本预算年有 ${currentPending.length} 笔消费待确认用途。`
                    : "新导入的账单会自动检查分类与重复。"}
                  <br />
                  退款、AA 与赠礼，都可以在明细里调整。
                </p>
                <button className="text-button" onClick={reviewTransactions}>
                  核对消费明细 <ArrowRight size={16} />
                </button>
                <div className="review-tip">
                  <span />
                  预算余额不等于银行卡可用余额
                </div>
              </div>
            </section>
          </>
        )}
        {page === "transactions" && (
          <>
            <PageHeading
              eyebrow="THE LITTLE DETAILS"
              title="每一笔，都有去处。"
              description="查找、核对和调整你的实际承担金额。"
              action={
                <button
                  className="button dark"
                  onClick={() =>
                    setEdit({
                      id: `manual-${Date.now()}`,
                      date: state.settings.asOf,
                      merchant: "",
                      description: "",
                      amount: 0,
                      categoryId: "uncategorized",
                      kind: "expense",
                      review: true,
                      source: "手动记账",
                    })
                  }
                >
                  <Plus size={17} />
                  记一笔
                </button>
              }
            />
            <div className="ledger-toolbar">
              <label className="search-field">
                <Search size={18} />
                <input
                  aria-label="搜索消费"
                  placeholder="搜索商户、商品或备注"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setRowLimit(40);
                  }}
                />
              </label>
              <select
                aria-label="筛选类目"
                value={ledgerCategory}
                onChange={(e) => {
                  setLedgerCategory(e.target.value);
                  setRowLimit(40);
                }}
              >
                <option value="all">全部消费</option>
                <option value="review">待确认用途</option>
                <option value="excluded">已排除 / 非消费</option>
                {state.categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="筛选月份"
                value={ledgerMonth}
                onChange={(e) => {
                  setLedgerMonth(e.target.value);
                  setRowLimit(40);
                }}
              >
                <option value="all">全部月份</option>
                {monthOptions.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="ledger-summary">
              <span>{ledger.length} 笔记录</span>
              <strong>
                {ledgerCategory === "excluded" ? "记录金额合计" : "消费净额"} ¥{" "}
                {money(
                  ledger.reduce(
                    (a, t) =>
                      a +
                      (ledgerCategory === "excluded"
                        ? Math.abs(t.amount)
                        : t.amount),
                    0,
                  ),
                  2,
                )}
              </strong>
            </div>
            <div className="ledger-list">
              <div className="ledger-head">
                <span>商户 / 商品</span>
                <span>日期 · 渠道</span>
                <span>消费分类</span>
                <span>实际承担</span>
                <span />
              </div>
              {ledger.slice(0, rowLimit).map((t) => (
                <button
                  className="ledger-row"
                  key={t.id}
                  onClick={() => setEdit(t)}
                >
                  <span className="merchant-cell">
                    <span
                      className={`category-icon small-icon tone-${t.categoryId}`}
                    >
                      <Icon name={t.categoryId} size={18} />
                    </span>
                    <span>
                      <strong>{t.merchant || "未填写商户"}</strong>
                      <small>
                        {t.description || t.note || "点击补充消费用途"}
                      </small>
                    </span>
                  </span>
                  <span className="date-cell">
                    {displayDate(t.date)}
                    <small>{t.source}</small>
                  </span>
                  <span className={`tag ${t.review ? "pending" : ""}`}>
                    {t.excluded
                      ? "不计消费"
                      : t.review
                        ? "待确认"
                        : getCat(t.categoryId)?.shortName ||
                          getCat(t.categoryId)?.name ||
                          t.kind}
                  </span>
                  <strong
                    className={`transaction-amount ${t.kind === "income" || t.kind === "refund" ? "refund" : ""}`}
                  >
                    {t.kind === "income" || t.kind === "refund"
                      ? "+"
                      : t.kind === "transfer"
                        ? ""
                        : "−"}{" "}
                    ¥ {money(Math.abs(t.amount), 2)}
                  </strong>
                  <Pencil className="edit-icon" size={15} />
                </button>
              ))}
              {!ledger.length && (
                <div className="empty-state">
                  <Search size={32} />
                  <h3>这里还没有消费记录</h3>
                  <p>试试其他筛选条件，或导入本月账单。</p>
                </div>
              )}
            </div>
            {ledger.length > rowLimit && (
              <button
                className="button load-more"
                onClick={() => setRowLimit((x) => x + 60)}
              >
                再显示 60 笔 <ChevronDown size={16} />
              </button>
            )}
          </>
        )}
        {page === "import" && (
          <>
            <PageHeading
              eyebrow="A FRESH START, EVERY MONTH"
              title="新的一月，账目也清楚。"
              description="把账单放进来，剩下的预算会自动更新。"
            />
            <div className="import-layout">
              <div>
                <div
                  className={`dropzone ${dragging ? "dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    loadFiles(Array.from(e.dataTransfer.files));
                  }}
                >
                  <div className="file-art">
                    <FileSpreadsheet size={44} strokeWidth={1.2} />
                    <span>＋</span>
                  </div>
                  <h2>{busy ? "正在读取你的账单…" : "把本月的账单放在这里"}</h2>
                  <p>拖入文件，或点击选择。支持一次导入多份账单。</p>
                  <button
                    className="button dark"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Upload size={17} />
                    )}
                    选择账单文件
                  </button>
                  <span className="format-label">
                    微信 XLSX · 支付宝 CSV · 标准 CSV / XLSX
                  </span>
                  <input
                    hidden
                    multiple
                    ref={fileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) =>
                      loadFiles(Array.from(e.target.files || []))
                    }
                  />
                </div>
                {importError && (
                  <div role="alert" className="alert error">
                    <AlertCircle size={18} />
                    {importError}
                  </div>
                )}
                <div className="import-actions">
                  <button className="text-button" onClick={template}>
                    <Download size={16} />
                    下载标准模板
                  </button>
                  <span>银行 PDF 请先转为标准表格</span>
                </div>
                <div className="section-heading import-history-title">
                  <h2>导入记录</h2>
                  <span className="muted small">
                    {state.batches.length} 个批次
                  </span>
                </div>
                <div className="batch-list">
                  {state.batches.map((b) => (
                    <div className="batch" key={b.id}>
                      <span className="icon-soft">
                        <FileSpreadsheet size={20} />
                      </span>
                      <div>
                        <strong>{b.name}</strong>
                        <small>
                          {b.date} · {b.count.toLocaleString()} 笔记录
                          {b.duplicates ? ` · 跳过 ${b.duplicates} 笔重复` : ""}
                        </small>
                      </div>
                      {b.id === "historical" ? (
                        <CheckCheck size={18} className="muted" />
                      ) : (
                        <button
                          className="icon-button"
                          aria-label={`撤销导入 ${b.name}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                "撤销这一批导入？该批交易的后续分类修改也会移除。",
                              )
                            ) {
                              setState((s) => ({
                                ...s,
                                transactions: removeBatchTransactions(
                                  s.transactions,
                                  b.transactionIds,
                                ),
                                batches: s.batches.filter((x) => x.id !== b.id),
                              }));
                              notify("已撤销本次导入");
                            }
                          }}
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                  {!state.batches.length && (
                    <p className="muted">
                      你的第一份账单，即将让预算清晰起来。
                    </p>
                  )}
                </div>
              </div>
              <aside className="import-guide">
                <span className="eyebrow">HOW IT WORKS</span>
                <h2>三步，让消费有数。</h2>
                {[
                  [
                    "01",
                    "导入原始账单",
                    "支持微信、支付宝导出文件，文件仅在当前浏览器处理。",
                  ],
                  [
                    "02",
                    "预览与核对",
                    "先检查重复记录和用途；转账、收入与还款单独识别。",
                  ],
                  [
                    "03",
                    "查看预算余额",
                    "确认后自动更新季度和年度余额。退款需关联原消费。",
                  ],
                ].map(([n, t, d]) => (
                  <div className="guide-step" key={n}>
                    <span>{n}</span>
                    <div>
                      <h3>{t}</h3>
                      <p>{d}</p>
                    </div>
                  </div>
                ))}
                <div className="privacy-note">
                  <ShieldCheck size={20} />
                  <p>
                    账本保存在当前浏览器。换手机、换浏览器前，记得导出备份。
                  </p>
                </div>
                <button
                  className="button outline full-width"
                  onClick={() => setUnlockOpen(true)}
                >
                  <ShieldCheck size={16} />
                  解锁已整理账本
                </button>
                <button className="button outline full-width" onClick={backup}>
                  <ArrowDownToLine size={16} />
                  导出完整备份
                </button>
                <button
                  className="text-button full-width"
                  onClick={() => backupRef.current?.click()}
                >
                  从备份恢复
                </button>
              </aside>
            </div>
          </>
        )}
        {page === "settings" && (
          <>
            <PageHeading
              eyebrow="MAKE IT YOURS"
              title="预算，按你的生活来。"
              description="月度预留可以积累，集中采购按季度和年度安排。"
              action={
                <button className="button dark" onClick={handleSaveSettings}>
                  <Check size={17} />
                  保存预算
                </button>
              }
            />
            <div className="settings-top">
              <div className="settings-panel">
                <h3>
                  <CalendarDays size={19} />
                  周期与结转
                </h3>
                <div className="field-pair">
                  <label>
                    预算年度起始月份
                    <input
                      type="month"
                      value={draftSettings.startMonth}
                      onChange={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          startMonth: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    查看截至日期
                    <input
                      type="date"
                      value={draftSettings.asOf}
                      onChange={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          asOf: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <label className="switch-line">
                  <span>
                    <strong>季度结余自动结转</strong>
                    <small>在同一预算年度内，余款或超支带入下一季</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={draftSettings.rollover}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        rollover: e.target.checked,
                      })
                    }
                  />
                </label>
              </div>
              <div className="settings-panel">
                <h3>
                  <Wallet size={19} />
                  工资的月度安排
                </h3>
                <div className="three-fields">
                  {(
                    [
                      ["monthlyIncome", "税后普通工资"],
                      ["savingsGoal", "每月储蓄目标"],
                      ["installments", "当前分期预留"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <div className="input-unit">
                        <span>¥</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draftSettings[key]}
                          onChange={(e) =>
                            setDraftSettings({
                              ...draftSettings,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </label>
                  ))}
                </div>
                <p className="settings-note">
                  分期还款用于现金安排；已计入购买的商品，不再次扣消费预算。
                </p>
              </div>
            </div>
            <div className="plan-banner">
              <span>
                <span className="status-dot" />
                当前工资安排
              </span>
              <p>
                ¥ {yuan(draftSettings.monthlyIncome)} 工资 − ¥{" "}
                {yuan(monthlyReserved)} 预留 − ¥{" "}
                {yuan(draftSettings.installments)} 分期 − ¥{" "}
                {yuan(draftSettings.savingsGoal)} 储蓄
              </p>
              <strong className={wageGap < -0.01 ? "danger-text" : ""}>
                余 ¥ {money(Math.round(wageGap * 100), 2)}
              </strong>
            </div>
            <div className="settings-table-wrap">
              <table className="budget-table">
                <thead>
                  <tr>
                    <th>预算类目</th>
                    <th>工资每月预留</th>
                    <th>奖金年度补充</th>
                    <th>全年预算</th>
                    <th>历史 16 个月月均</th>
                    <th>近 4 个月月均</th>
                  </tr>
                </thead>
                <tbody>
                  {draftCategories.map((c, i) => (
                    <tr key={c.id}>
                      <td>
                        <span
                          className={`category-icon small-icon tone-${c.id}`}
                        >
                          <Icon name={c.id} size={17} />
                        </span>
                        {c.shortName || c.name}
                      </td>
                      <td>
                        <input
                          aria-label={`${c.name}工资每月预留`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.monthly}
                          onChange={(e) =>
                            setDraftCategories((cs) =>
                              cs.map((x, j) =>
                                j === i
                                  ? { ...x, monthly: Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${c.name}奖金年度补充`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.bonus}
                          onChange={(e) =>
                            setDraftCategories((cs) =>
                              cs.map((x, j) =>
                                j === i
                                  ? { ...x, bonus: Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>¥ {yuan(c.monthly * 12 + c.bonus)}</strong>
                      </td>
                      <td>
                        {c.history16 === null
                          ? "待核"
                          : `¥ ${c.history16.toFixed(2)}`}
                      </td>
                      <td>
                        {c.recent4 === null
                          ? "待核"
                          : `¥ ${c.recent4.toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>合计</td>
                    <td>
                      ¥{" "}
                      {yuan(draftCategories.reduce((a, c) => a + c.monthly, 0))}
                    </td>
                    <td>
                      ¥ {yuan(draftCategories.reduce((a, c) => a + c.bonus, 0))}
                    </td>
                    <td>
                      ¥{" "}
                      {yuan(
                        draftCategories.reduce(
                          (a, c) => a + c.monthly * 12 + c.bonus,
                          0,
                        ),
                      )}
                    </td>
                    <td colSpan={2}>历史覆盖不完整，不强行合计</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="footnote">
              {historyRangeLabel(state.metadata)}{" "}
              原单净额含分期购买，退款归原单。奖金补充为规划，到账后才形成可用资金。
            </p>
            <div className="settings-footer">
              <button className="button outline" onClick={backup}>
                <Download size={16} />
                备份账本
              </button>
              <button
                className="text-button"
                onClick={() => backupRef.current?.click()}
              >
                恢复备份
              </button>
              <button className="button dark" onClick={handleSaveSettings}>
                保存预算 <Check size={16} />
              </button>
            </div>
          </>
        )}
        <footer>
          <span className="footer-brand">
            留白 daily<span>给生活一点余地。</span>
          </span>
          <span>
            <span className="tiny-dot" />
            你的账本，只留在这里。
          </span>
          <button onClick={() => setModal("help")}>
            使用说明 <ArrowUpRight size={13} />
          </button>
        </footer>
      </main>
      <nav className="mobile-nav" aria-label="手机导航">
        {(
          [
            ["overview", "预算", LayoutGrid],
            ["transactions", "明细", ListFilter],
            ["import", "导入", Plus],
            ["settings", "设置", SlidersHorizontal],
          ] as const
        ).map(([id, label, C]) => (
          <button
            key={id}
            className={page === id ? "active" : ""}
            onClick={() => nav(id)}
          >
            <C size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <input
        hidden
        ref={backupRef}
        type="file"
        accept=".json"
        onChange={(e) => {
          if (e.target.files?.[0]) restore(e.target.files[0]);
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {selected && (
        <Modal
          title={selected.name}
          subtitle="预算看长期，花费看实际。"
          onClose={() => setDetail(null)}
        >
          <div className="detail-totals">
            <div>
              <span>季度预算剩余</span>
              <strong>¥ {money(selected.quarterRemaining, 2)}</strong>
              <small>本季已用 ¥ {money(selected.quarterSpent, 2)}</small>
            </div>
            <div>
              <span>年度预算剩余</span>
              <strong>¥ {money(selected.annualRemaining, 2)}</strong>
              <small>全年预算 ¥ {money(selected.annualBudget)}</small>
            </div>
          </div>
          {selected.pendingCount > 0 && (
            <div className="alert">
              <AlertCircle size={17} />
              此类目还有 {selected.pendingCount} 笔、¥{" "}
              {money(selected.pendingAmount, 2)} 待核，未从上方已确认余额扣除。
            </div>
          )}
          <div className="detail-lines">
            <span>
              本季基础额度 <b>¥ {money(selected.quarterBudget)}</b>
            </span>
            <span>
              上季结余 / 超支结转 <b>¥ {money(selected.carry, 2)}</b>
            </span>
            <span>
              工资每月预留 <b>¥ {yuan(selected.monthly)}</b>
            </span>
            <span>
              奖金年度补充（规划）<b>¥ {yuan(selected.bonus)}</b>
            </span>
          </div>
          <label className="fund-field">
            当前实际可用的专项资金
            <div className="input-unit">
              <span>¥</span>
              <input
                aria-label="实际可用专项资金"
                type="number"
                min="0"
                step="0.01"
                placeholder="核对余额后填写"
                value={
                  state.funds[selected.id] === undefined
                    ? ""
                    : state.funds[selected.id] / 100
                }
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    funds: {
                      ...s.funds,
                      [selected.id]: Math.max(
                        0,
                        Math.round(Number(e.target.value) * 100),
                      ),
                    },
                  }))
                }
              />
            </div>
            <small>
              手动核对值，消费后请同步更新；预算额度不会自动变成现金。
            </small>
          </label>
          <div className="modal-actions">
            <button
              className="button outline"
              onClick={() => {
                setLedgerCategory(selected.id);
                setLedgerMonth("all");
                setDetail(null);
                nav("transactions");
              }}
            >
              查看消费明细
            </button>
            <button
              className="button dark"
              onClick={() => {
                setCalcCategory(selected.id);
                setDetail(null);
                setCalculator(true);
              }}
            >
              消费前试算 <ArrowUpRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {calculator && (
        <Modal
          title="这次心动，放得下吗？"
          subtitle="看看购买后，季度和年度还剩多少余地。"
          onClose={() => setCalculator(false)}
        >
          <label className="form-label">
            这次准备买
            <select
              value={calc.id}
              onChange={(e) => setCalcCategory(e.target.value)}
            >
              {state.categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            预计实际承担金额
            <div className="input-unit big-input">
              <span>¥</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={calcAmount}
                onChange={(e) => setCalcAmount(e.target.value)}
              />
            </div>
          </label>
          <div className="detail-totals">
            <div>
              <span>购买后季度剩余</span>
              <strong
                className={
                  calc.quarterRemaining - calcCents < 0 ? "danger-text" : ""
                }
              >
                ¥ {money(calc.quarterRemaining - calcCents, 2)}
              </strong>
            </div>
            <div>
              <span>购买后年度剩余</span>
              <strong
                className={
                  calc.annualRemaining - calcCents < 0 ? "danger-text" : ""
                }
              >
                ¥ {money(calc.annualRemaining - calcCents, 2)}
              </strong>
            </div>
          </div>
          <div className="calc-verdict">
            {calcCents <= 0
              ? "输入价格，给这次消费一点思考空间。"
              : calc.annualRemaining < calcCents
                ? "超出年度额度，先调整其他预算或延后购买。"
                : calc.quarterRemaining < calcCents
                  ? "年度尚有额度，但本季已不足。可以延后采购，或重新安排季度节奏。"
                  : "在当前已确认预算范围内。再核对专项资金与待确认消费，就可以从容决定。"}
          </div>
          <p className="footnote">
            {state.funds[calc.id] === undefined
              ? "实际资金余额尚未填写，不能据此判断现金是否足够。"
              : `手动记录的专项可用资金 ¥ ${money(state.funds[calc.id], 2)}，购买后 ¥ ${money(state.funds[calc.id] - calcCents, 2)}。`}
            {pendingTotal > 0 &&
              ` 本年度另有 ¥ ${money(pendingTotal, 2)} 待核消费，类目余额可能继续减少。`}
          </p>
        </Modal>
      )}
      {edit && (
        <TransactionEditor
          transaction={edit}
          transactions={state.transactions}
          categories={state.categories}
          onClose={() => setEdit(null)}
          onSave={(t) => {
            setState((s) => ({
              ...s,
              transactions: s.transactions.some((x) => x.id === t.id)
                ? s.transactions.map((x) => (x.id === t.id ? t : x))
                : [...s.transactions, t],
            }));
            setEdit(null);
            notify("消费已更新，预算已重新计算");
          }}
          onExclude={() => {
            try {
              if (!edit.excluded)
                validateTransactionExclusion(edit, state.transactions);
            } catch (e) {
              notify(e instanceof Error ? e.message : "请先核对关联退款");
              return;
            }
            setState((s) => ({
              ...s,
              transactions: s.transactions.map((t) =>
                t.id === edit.id ? { ...t, excluded: !t.excluded } : t,
              ),
            }));
            setEdit(null);
            notify("已从消费统计排除，原记录仍保留在备份中");
          }}
        />
      )}
      {preview && (
        <Modal
          wide
          title="先核对，再记入。"
          subtitle={preview.names}
          onClose={() => setPreview(null)}
        >
          <div className="import-stats">
            <div>
              <strong>{preview.transactions.length}</strong>
              <span>可导入记录</span>
            </div>
            <div>
              <strong>{preview.duplicates}</strong>
              <span>已跳过重复</span>
            </div>
            <div>
              <strong>
                {preview.transactions.filter((t) => t.review).length}
              </strong>
              <span>用途待确认</span>
            </div>
          </div>
          {preview.warnings.map((w, i) => (
            <p className="alert small" key={i}>
              <AlertCircle size={16} />
              {w}
            </p>
          ))}
          <div className="preview-list">
            {preview.transactions.slice(0, 50).map((t) => (
              <div key={t.id}>
                <span>
                  {t.date}
                  <strong>{t.merchant || t.description}</strong>
                </span>
                <span className="tag">
                  {t.review
                    ? "待确认"
                    : t.kind === "expense"
                      ? getCat(t.categoryId)?.shortName ||
                        getCat(t.categoryId)?.name
                      : t.kind === "income"
                        ? "收入（不扣预算）"
                        : t.kind === "repayment"
                          ? "还款（不扣预算）"
                          : t.kind === "transfer"
                            ? "转账（不扣预算）"
                            : "退款"}
                </span>
                <strong>¥ {money(t.amount, 2)}</strong>
              </div>
            ))}
          </div>
          {preview.transactions.length > 50 && (
            <p className="footnote">
              预览前 50 笔，完整记录导入后可在消费明细查看。
            </p>
          )}
          <div className="modal-actions">
            <button className="button outline" onClick={() => setPreview(null)}>
              取消
            </button>
            <button
              disabled={!preview.transactions.length}
              className="button dark"
              onClick={commitImport}
            >
              确认导入 {preview.transactions.length} 笔 <Check size={17} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="关于这本生活账。" onClose={() => setModal(null)}>
          <div className="help-copy">
            <h3>额度与现金，分别看</h3>
            <p>
              全年预算 = 工资每月预留 × 12 +
              奖金年度补充。默认每季分配全年额度的四分之一，同年内可结转，跨预算年重新开始。尚未到账的奖金不代表可以提前支出。
            </p>
            <h3>记录完整，余额才更准确</h3>
            <p>
              未导入的支出不会自动补记，请核对各支付渠道是否完整覆盖。季度、年度余额是记录范围内的预算参考值。
            </p>
            <h3>退款、AA 与分期</h3>
            <p>
              已整理历史按原购买净额记录，包含已核对退款及
              AA。新退款先待确认，在编辑中关联原消费并使用原消费日期；分期商品计一次购买，后续还款不再次扣消费预算。赠礼算在你实际承担的人情支出。
            </p>
            <h3>数据保存在当前设备</h3>
            <p>
              导入文件仅在浏览器解析。数据保存在本机浏览器，不自动跨设备同步；专属入口可解锁已整理的加密快照，本机后来新增的记录仍需备份迁移。清除浏览器数据会移除本机账本。请定期导出备份，在手机上恢复即可继续使用。
            </p>
          </div>
          <button className="button dark full-width" onClick={backup}>
            <Download size={17} />
            导出完整备份
          </button>
        </Modal>
      )}
      {unlockOpen && (
        <Modal
          title="打开你的私密账本。"
          subtitle="粘贴专属入口或解锁密钥，仅在当前浏览器解密。"
          onClose={() => {
            if (!vaultBusy) {
              setUnlockOpen(false);
              setUnlockInput("");
            }
          }}
        >
          <label className="form-label">
            专属入口 / 解锁密钥
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={unlockInput}
              onChange={(e) => setUnlockInput(e.target.value)}
              placeholder="粘贴完整专属链接或密钥"
            />
          </label>
          {vaultError && (
            <p className="danger-text small" role="alert">
              {vaultError}
            </p>
          )}
          <p className="footnote">
            公开网页保存的是加密快照。密钥不会上传；加载后账本保存在本机浏览器。
          </p>
          <button
            className="button dark full-width"
            disabled={vaultBusy || !unlockInput.trim()}
            onClick={() => {
              const input = unlockInput.trim();
              let hash = input.startsWith("#") ? input : `#vault=${input}`;
              try {
                if (/^https?:\/\//.test(input)) hash = new URL(input).hash;
              } catch {
                setVaultError("专属入口格式无效，请粘贴完整链接。");
                return;
              }
              const key = parseVaultKey(hash);
              if (!key) {
                setVaultError("密钥格式不正确，请使用完整的专属入口。");
                return;
              }
              setVaultError("");
              setUnlockInput("");
              setVaultKey(key);
            }}
          >
            {vaultBusy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            解锁并载入
          </button>
        </Modal>
      )}
      {vaultIncoming && (
        <Modal
          title="本机已经有一本生活账。"
          subtitle="为保留你后来导入或修改的记录，本次尚未替换当前账本。"
          onClose={() => setVaultIncoming(null)}
        >
          <div className="detail-totals">
            <div>
              <span>当前本机记录</span>
              <strong>{state.transactions.length.toLocaleString()} 笔</strong>
            </div>
            <div>
              <span>已整理快照记录</span>
              <strong>
                {vaultIncoming.snapshot.transactions.length.toLocaleString()} 笔
              </strong>
            </div>
          </div>
          <p className="footnote">
            选择载入时，将先下载本机账本备份，再替换为已核对版本，避免把原单与净额重复合并。
          </p>
          <div className="modal-actions">
            <button
              className="button outline"
              onClick={() => {
                setVaultIncoming(null);
                notify("已保留本机账本");
              }}
            >
              保留本机账本
            </button>
            <button
              className="button dark"
              onClick={() => {
                backup();
                try {
                  installSnapshot(
                    vaultIncoming.snapshot,
                    vaultIncoming.fingerprint,
                  );
                } catch {
                  setVaultError(
                    "浏览器存储失败，本机账本未替换，请先导出备份后重试。",
                  );
                }
              }}
            >
              备份并载入已整理版本
            </button>
          </div>
        </Modal>
      )}
      {modal === "saving" && (
        <Modal
          title="记下这一份积累。"
          subtitle={`${month} · 填写本月实际净存入的总额，重复填写将更新原值。`}
          onClose={() => setModal(null)}
        >
          <label className="form-label">
            本月累计净存入
            <div className="input-unit big-input">
              <span>¥</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={saveAmount}
                onChange={(e) => setSaveAmount(e.target.value)}
              />
            </div>
          </label>
          <p className="footnote">
            生活采购预留不算已完成储蓄。这里只记录你核对过的实际结果。
          </p>
          <button
            className="button dark full-width"
            onClick={() => {
              if (
                !Number.isFinite(Number(saveAmount)) ||
                Number(saveAmount) < 0
              )
                return;
              setState((s) => ({
                ...s,
                saved: {
                  ...s.saved,
                  [month]: Math.round(Number(saveAmount) * 100),
                },
              }));
              setModal(null);
              notify("已更新本月储蓄记录");
            }}
          >
            保存记录 <Check size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="page-heading inner-heading">
      <div>
        <div className="eyebrow">
          <span className="tiny-dot" />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </section>
  );
}
function TransactionEditor({
  transaction,
  transactions,
  categories,
  onClose,
  onSave,
  onExclude,
}: {
  transaction: Transaction;
  transactions: Transaction[];
  categories: Category[];
  onClose: () => void;
  onSave: (t: Transaction) => void;
  onExclude: () => void;
}) {
  const [t, setT] = useState(transaction);
  const [amount, setAmount] = useState(
    String(Math.abs(transaction.amount) / 100),
  );
  const [error, setError] = useState("");
  const [refundSearch, setRefundSearch] = useState("");
  const [acknowledgeHistoricalNet, setAcknowledgeHistoricalNet] =
    useState(false);
  const original = transactions.find(
    (x) =>
      x.kind === "expense" &&
      (x.id === t.originalId || x.externalId === t.originalId),
  );
  const originals = transactions
    .filter(
      (x) =>
        x.kind === "expense" &&
        !x.excluded &&
        !x.review &&
        `${x.date} ${x.merchant} ${x.description} ${x.externalId || ""}`
          .toLowerCase()
          .includes(refundSearch.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  return (
    <Modal
      title={
        transaction.id.startsWith("manual-") && !transaction.merchant
          ? "记一笔实际消费。"
          : "让这笔消费更准确。"
      }
      subtitle="按最终用途分类，只记录你实际承担的部分。"
      onClose={onClose}
    >
      <div className="field-pair">
        <label>
          日期
          <input
            type="date"
            value={t.date}
            onChange={(e) => setT({ ...t, date: e.target.value })}
          />
        </label>
        <label>
          实际承担金额（元）
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      </div>
      <label className="form-label">
        商户 / 对象
        <input
          value={t.merchant}
          onChange={(e) => setT({ ...t, merchant: e.target.value })}
          placeholder="例如：服饰店 / 房东"
        />
      </label>
      <label className="form-label">
        商品或用途
        <input
          value={t.description}
          onChange={(e) => setT({ ...t, description: e.target.value })}
        />
      </label>
      <div className="field-pair">
        <label>
          交易性质
          <select
            aria-label="交易性质"
            value={t.kind}
            onChange={(e) =>
              setT({ ...t, kind: e.target.value as Transaction["kind"] })
            }
          >
            <option value="expense">消费支出</option>
            <option value="refund">退款</option>
            <option value="income">收入</option>
            <option value="transfer">转账 / 代收代付</option>
            <option value="repayment">分期 / 借款还款</option>
          </select>
        </label>
        <label>
          消费类目
          <select
            aria-label="消费类目"
            value={t.categoryId}
            onChange={(e) => setT({ ...t, categoryId: e.target.value })}
          >
            <option value="uncategorized">待确认用途</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {t.kind === "refund" && (
        <>
          <label className="form-label">
            关联原消费
            <input
              value={refundSearch}
              onChange={(e) => setRefundSearch(e.target.value)}
              placeholder="搜索原商户、商品、日期或订单号"
            />
          </label>
          {original ? (
            <div className="alert">
              <Check size={16} />
              已关联 {original.date} · {original.merchant} · ¥{" "}
              {money(original.amount, 2)}
            </div>
          ) : (
            <p className="footnote">
              请选择下方原消费，确认后自动归回原购买日期与类目。
            </p>
          )}
          <div className="original-options">
            {originals.map((o) => (
              <button
                key={o.id}
                className={original?.id === o.id ? "selected" : ""}
                onClick={() => {
                  setT({ ...t, originalId: o.id, categoryId: o.categoryId });
                  setAcknowledgeHistoricalNet(false);
                }}
              >
                <span>
                  {o.date} · {o.merchant}
                </span>
                <strong>¥ {money(o.amount, 2)}</strong>
              </button>
            ))}
          </div>
          {original?.note?.includes("历史净额") && (
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={acknowledgeHistoricalNet}
                onChange={(e) => setAcknowledgeHistoricalNet(e.target.checked)}
              />
              我已核对：此退款尚未包含在历史原单净额中
            </label>
          )}
          <p className="footnote">
            已在原单净额抵扣的退款请排除，避免重复回补额度。
          </p>
        </>
      )}
      <label className="form-label">
        备注
        <textarea
          rows={2}
          value={t.note || ""}
          onChange={(e) => setT({ ...t, note: e.target.value })}
          placeholder="例如：生日赠礼 / 多人 AA 后的个人承担"
        />
      </label>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={!t.review}
          onChange={(e) => setT({ ...t, review: !e.target.checked })}
        />
        我已核对用途与金额
      </label>
      {error && (
        <p role="alert" className="danger-text small">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="text-button muted" onClick={onExclude}>
          {t.excluded ? "此笔已排除" : "排除本笔消费"}
        </button>
        <button
          className="button dark"
          onClick={() => {
            if (
              !t.date ||
              !t.merchant.trim() ||
              !Number.isFinite(Number(amount)) ||
              Number(amount) <= 0
            ) {
              setError("请填写日期、商户及大于零的有效金额。");
              return;
            }
            if (
              !t.review &&
              ["expense", "refund"].includes(t.kind) &&
              t.categoryId === "uncategorized"
            ) {
              setError("请选择消费类目，或保留为待确认。");
              return;
            }
            if (t.kind === "refund" && !t.review && !t.originalId) {
              setError("确认退款前，请填写原消费编号并核对归属日期。");
              return;
            }
            try {
              onSave(
                validateAndNormalizeTransaction(
                  {
                    ...t,
                    amount:
                      Math.round(Number(amount) * 100) *
                      (t.kind === "refund" ? -1 : 1),
                  },
                  transactions,
                  { acknowledgeHistoricalNet },
                ),
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "请检查交易信息");
            }
          }}
        >
          保存修改 <Check size={16} />
        </button>
      </div>
    </Modal>
  );
}
