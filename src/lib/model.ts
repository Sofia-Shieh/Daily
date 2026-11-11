export type Category = {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  tone: string;
  monthly: number;
  bonus: number;
  annual: number;
  history16: number | null;
  recent4: number | null;
};

export type Transaction = {
  id: string;
  date: string;
  merchant: string;
  description: string;
  /** Integer RMB cents. Expenses positive, linked refunds negative. */
  amount: number;
  categoryId: string;
  kind: "expense" | "refund" | "income" | "transfer" | "repayment";
  review: boolean;
  source: string;
  externalId?: string;
  originalId?: string;
  excluded?: boolean;
  note?: string;
};

export type Settings = {
  startMonth: string;
  asOf: string;
  rollover: boolean;
  monthlyIncome: number;
  savingsGoal: number;
  installments: number;
};

const todayInShanghai = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

/** A new installation starts empty; private plans can be restored from a local backup. */
export const defaultSettings: Settings = {
  startMonth: todayInShanghai.slice(0, 7),
  asOf: todayInShanghai,
  rollover: true,
  monthlyIncome: 0,
  savingsGoal: 0,
  installments: 0,
};

export const defaultCategories: Category[] = [
  {
    id: "rent",
    name: "房租",
    shortName: "居住",
    icon: "House",
    tone: "sand",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "food",
    name: "餐饮与饮品",
    shortName: "餐饮",
    icon: "Utensils",
    tone: "peach",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "transport",
    name: "日常交通",
    shortName: "交通",
    icon: "Car",
    tone: "blue",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "clothing",
    name: "服饰鞋包",
    shortName: "服饰",
    icon: "Shirt",
    tone: "lavender",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "beauty",
    name: "美妆护肤",
    shortName: "美妆",
    icon: "Sparkles",
    tone: "pink",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "home",
    name: "家居与数码",
    shortName: "家居",
    icon: "Armchair",
    tone: "green",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "fitness",
    name: "健身",
    shortName: "健身",
    icon: "Dumbbell",
    tone: "peach",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "leisure",
    name: "娱乐与体验",
    shortName: "娱乐",
    icon: "Ticket",
    tone: "lavender",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "health",
    name: "健康医疗",
    shortName: "健康",
    icon: "HeartPulse",
    tone: "pink",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "learning",
    name: "学习成长",
    shortName: "学习",
    icon: "BookOpen",
    tone: "blue",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "gifts",
    name: "赠礼与人情",
    shortName: "赠礼",
    icon: "Gift",
    tone: "pink",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "subscriptions",
    name: "订阅会员",
    shortName: "订阅",
    icon: "Layers",
    tone: "blue",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "utilities",
    name: "水电与通信",
    shortName: "水电",
    icon: "Zap",
    tone: "sand",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "travel",
    name: "旅行",
    shortName: "旅行",
    icon: "Plane",
    tone: "blue",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
  {
    id: "buffer",
    name: "机动与其他",
    shortName: "机动",
    icon: "Ellipsis",
    tone: "sand",
    monthly: 0,
    bonus: 0,
    annual: 0,
    history16: null,
    recent4: null,
  },
];

export const cents = (yuan: number) => Math.round(yuan * 100);
export const formatMoney = (
  amount: number,
  options: { decimals?: number } | number = {},
) => {
  const decimals =
    typeof options === "number" ? options : (options.decimals ?? 2);
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount / 100);
};

const monthIndex = (value: string) =>
  Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
const monthString = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
const monthEnd = (index: number) => {
  const month = monthString(index);
  return `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`;
};

export function getPeriod(settings: Settings) {
  const start = monthIndex(settings.startMonth);
  const now = monthIndex(settings.asOf);
  const active = now >= start;
  const yearIndex = active ? Math.floor((now - start) / 12) : 0;
  const annualStart = start + yearIndex * 12;
  const quarter = active ? Math.floor((now - annualStart) / 3) + 1 : 1;
  const qStart = annualStart + (quarter - 1) * 3;
  const yearStart = `${monthString(annualStart)}-01`;
  const yearEnd = monthEnd(annualStart + 11);
  const quarterStart = `${monthString(qStart)}-01`;
  const quarterEnd = monthEnd(qStart + 2);
  return {
    active,
    yearStart,
    yearEnd,
    quarterStart,
    quarterEnd,
    quarter,
    quarterLabel: `${monthString(qStart).replace("-", ".")} — ${monthString(qStart + 2).replace("-", ".")}`,
    yearLabel: `${monthString(annualStart).replace("-", ".")} — ${monthString(annualStart + 11).replace("-", ".")}`,
  };
}

export type BudgetCategory = Category & {
  annualBudget: number;
  quarterBudget: number;
  yearSpent: number;
  quarterSpent: number;
  priorSpent: number;
  carry: number;
  quarterAvailable: number;
  quarterRemaining: number;
  annualRemaining: number;
  monthSpent: number;
  pendingAmount: number;
  pendingCount: number;
};

export function computeBudget(
  transactions: Transaction[],
  categories: Category[],
  settings: Settings,
) {
  const period = getPeriod(settings);
  const validIds = new Set(categories.map((c) => c.id));
  const inYear = transactions.filter(
    (t) =>
      t.date >= period.yearStart &&
      t.date <= period.yearEnd &&
      t.date <= settings.asOf &&
      !t.excluded &&
      (t.kind === "expense" || t.kind === "refund"),
  );
  const pending = inYear.filter((t) => t.review || !validIds.has(t.categoryId));
  const cleared = inYear.filter((t) => !t.review && validIds.has(t.categoryId));
  const sum = (ts: Transaction[]) => ts.reduce((a, t) => a + t.amount, 0);
  const mapped: BudgetCategory[] = categories.map((c) => {
    const rows = cleared.filter((t) => t.categoryId === c.id);
    const reviews = pending.filter((t) => t.categoryId === c.id);
    const annualBudget = cents(c.annual);
    // Derive cumulative quarters from annual cents so uneven divisions never create money.
    const cumulative = Math.round((annualBudget * period.quarter) / 4);
    const previousAllocation = Math.round(
      (annualBudget * (period.quarter - 1)) / 4,
    );
    const quarterBudget = cumulative - previousAllocation;
    const quarterSpent = sum(
      rows.filter(
        (t) => t.date >= period.quarterStart && t.date <= period.quarterEnd,
      ),
    );
    const priorSpent = sum(rows.filter((t) => t.date < period.quarterStart));
    const yearSpent = sum(rows);
    const carry = settings.rollover ? previousAllocation - priorSpent : 0;
    const quarterAvailable = quarterBudget + carry;
    return {
      ...c,
      annualBudget,
      quarterBudget,
      yearSpent,
      quarterSpent,
      priorSpent,
      carry,
      quarterAvailable,
      quarterRemaining: quarterAvailable - quarterSpent,
      annualRemaining: annualBudget - yearSpent,
      monthSpent: sum(
        rows.filter((t) => t.date.slice(0, 7) === settings.asOf.slice(0, 7)),
      ),
      pendingAmount: sum(reviews.filter((t) => t.amount > 0)),
      pendingCount: reviews.length,
    };
  });
  const aggregate = (key: keyof BudgetCategory) =>
    mapped.reduce((s, c) => s + Number(c[key]), 0);
  return {
    period,
    categories: mapped,
    total: {
      annualBudget: aggregate("annualBudget"),
      yearSpent: aggregate("yearSpent"),
      annualRemaining: aggregate("annualRemaining"),
      quarterBudget: aggregate("quarterBudget"),
      quarterSpent: aggregate("quarterSpent"),
      quarterRemaining: aggregate("quarterRemaining"),
      pendingAmount: sum(pending.filter((t) => t.amount > 0)),
      pendingCount: pending.length,
    },
    monthSpent: aggregate("monthSpent"),
  };
}

export function inferCategory(text: string): {
  categoryId: string;
  review: boolean;
} {
  const t = text.toLowerCase();
  const rules: [string, RegExp][] = [
    ["gifts", /生日礼物|赠礼|送给|生日红包/],
    ["rent", /房租|租金|住房租赁/],
    ["fitness", /健身|超级猩猩|普拉提|瑜伽课程/],
    ["health", /药房|大药|医药|医院|门诊|体检|挂号|药品|医疗/],
    ["travel", /机票|酒店|旅馆|旅行|旅游|签证|景点门票|度假|火车票|高铁票/],
    [
      "subscriptions",
      /会员费|会员续费|视频会员|音乐会员|云空间|icloud|软件订阅|88vip|尊享会员/,
    ],
    ["utilities", /电费|燃气费|水费|宽带费|话费|手机充值/],
    [
      "beauty",
      /护肤|美妆|洗发|护发|精华液|面霜|口红|粉底|防晒|洁面|化妆|洗面奶|面膜|兰蔻|雅诗兰黛/,
    ],
    [
      "clothing",
      /服饰|女装|男装|连衣裙|衬衫|外套|羽绒|卫衣|长裤|牛仔裤|半身裙|运动鞋|皮鞋|凉鞋|短靴|围巾|针织|毛衣|内衣|袜子|鞋包/,
    ],
    [
      "home",
      /四件套|床品|落地灯|台灯|挂衣架|置物架|落地镜|家具|家居|数码|充电器|耳机|手机壳|退货运费|退货寄件/,
    ],
    ["learning", /图书|书籍|教材|培训课程|学习课程|考试报名/],
    ["leisure", /电影票|电影院|演唱会|音乐节|摄影体验|展览|脱口秀|剧院|演出票/],
    [
      "transport",
      /地铁|公交|滴滴|高德打车|出租车|网约车|停车费|共享单车|哈啰骑行|交通出行/,
    ],
    [
      "food",
      /餐饮|餐厅|饭店|外卖订单|咖啡|奶茶|饮品|火锅|烧烤|烤肉|饺子|面馆|便当|食堂|皮爷|星巴克|瑞幸|美食|披萨|汉堡/,
    ],
  ];
  for (const [categoryId, re] of rules)
    if (re.test(t)) return { categoryId, review: false };
  return { categoryId: "uncategorized", review: true };
}
