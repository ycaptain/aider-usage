import Table from "cli-table3";
import type { UsageRow } from "./aggregate.js";
import type { Style } from "./style.js";
import type { Format } from "./capability.js";

export function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 渲染选项 (REQ-004: 注入式, 渲染层不读 env/不调 console)。
 * style/markers/unicode 三者均由 cli 经 resolveColor 解析后注入。
 */
export interface RenderOpts {
  style: Style;
  format: Format;
  /** 是否在 Cost 单元格放档位标记 (仅 TTY 上的 table)。 */
  markers: boolean;
  /** 标记字符集。 */
  unicode: boolean;
}

export type CostTier = "high" | "mid" | "low";
type Align = "left" | "right";

/**
 * 相对成本分级 (REQ-002 / ADR-004)。
 * 前置: maxCost = max(body 行 cost), 不含 TOTAL。
 * 守卫: maxCost ≤ 0 → 全 low (防全零数据除零式误标 high)。
 * 后置: cost ≤ 0 → low; ≥0.66·maxCost → high; ≥0.33·maxCost → mid; 否则 low。
 */
export function costTier(cost: number, maxCost: number): CostTier {
  if (maxCost <= 0) return "low";
  if (cost <= 0) return "low";
  if (cost >= 0.66 * maxCost) return "high";
  if (cost >= 0.33 * maxCost) return "mid";
  return "low";
}

function tierMarker(tier: CostTier, unicode: boolean): string {
  const set = unicode
    ? { high: "▲", mid: "=", low: "·" }
    : { high: "^", mid: "=", low: "." };
  return set[tier];
}

/**
 * 格式无关的表模型: body 单元格为裸值 (无 ANSI/无标记), 着色/标记/分隔在格式化时施加。
 * data 是结构化载荷, 仅 json 使用。
 */
interface TableModel {
  head: string[];
  aligns: Align[];
  body: Array<{ cells: string[]; tier: CostTier }>;
  /** TOTAL 行裸值; 不分级, 渲染时加粗。 */
  total?: string[];
  /** 适用档位标记/着色的列下标 (Cost 列); 无则 undefined。 */
  costCol?: number;
  data: unknown;
}

/** 用量表模型 (period/model/session 共用)。 */
function usageModel(
  rows: UsageRow[],
  columnLabel: string,
  bodyLimit?: number,
  includeTotal = true,
): TableModel {
  // 显示行可被 --top 截断; TOTAL 仍覆盖全量 (REQ-007: "TOTAL covers all")。
  const display = bodyLimit !== undefined ? rows.slice(0, bodyLimit) : rows;
  const maxCost = display.reduce((m, r) => Math.max(m, r.cost), 0);
  const skipTier = display.length <= 1; // 单行表无可比性, 跳过分级 (REQ-002)
  const body = display.map((r) => ({
    cells: [
      r.key,
      formatCost(r.cost),
      formatTokens(r.promptTokens),
      formatTokens(r.completionTokens),
      formatTokens(r.count),
    ],
    tier: skipTier ? ("low" as const) : costTier(r.cost, maxCost),
  }));
  let total: string[] | undefined;
  if (includeTotal && rows.length > 0) {
    const sum = rows.reduce(
      (a, r) => {
        a.cost += r.cost;
        a.prompt += r.promptTokens;
        a.completion += r.completionTokens;
        a.count += r.count;
        return a;
      },
      { cost: 0, prompt: 0, completion: 0, count: 0 },
    );
    total = [
      "TOTAL",
      formatCost(sum.cost),
      formatTokens(sum.prompt),
      formatTokens(sum.completion),
      formatTokens(sum.count),
    ];
  }
  return {
    head: [columnLabel, "Cost", "Prompt", "Completion", "Msgs"],
    aligns: ["left", "right", "right", "right", "right"],
    body,
    ...(total ? { total } : {}),
    costCol: 1,
    data: display, // json/csv 反映与 table 相同的行选择 (REQ-007)
  };
}

/** commands 保留独立列定义 (REQ-004: 不伪装成 UsageRow)。 */
function commandModel(
  rows: Array<{ command: string; count: number }>,
): TableModel {
  return {
    head: ["Command", "Count"],
    aligns: ["left", "right"],
    body: rows.map((r) => ({
      cells: [r.command, formatTokens(r.count)],
      tier: "low" as const,
    })),
    data: rows,
  };
}

/** 单元格装饰: 档位标记 (固定 2 字符槽) + 按档位着色。仅 table 路径调用。 */
function decorateCell(
  row: { cells: string[]; tier: CostTier },
  colIdx: number,
  model: TableModel,
  opts: RenderOpts,
): string {
  let text = row.cells[colIdx] ?? "";
  const isCost = colIdx === model.costCol;
  if (isCost && opts.markers) {
    text = `${tierMarker(row.tier, opts.unicode)} ${text}`;
  }
  if (row.tier === "low") return opts.style.dim(text);
  if (isCost && row.tier === "high") return opts.style.costHigh(text);
  return text;
}

function renderCliTable(model: TableModel, opts: RenderOpts): string {
  if (model.body.length === 0 && !model.total) return ""; // 空 table → stdout 空 (REQ-003)
  const colored = opts.style.colorEnabled;
  const table = new Table({
    head: model.head,
    colAligns: model.aligns,
    // 关掉 cli-table3 自带的红表头/灰边框着色, 否则无色路径仍泄漏 ANSI (NFR-R-001)。
    style: colored
      ? { head: ["bold"], border: ["grey"] }
      : { head: [], border: [] },
  });
  for (const row of model.body) {
    table.push(model.head.map((_, i) => decorateCell(row, i, model, opts)));
  }
  if (model.total) {
    table.push(model.total.map((c) => opts.style.bold(c)));
  }
  return table.toString();
}

/** GFM 表 (REQ-006)。空表仅表头+分隔行。无 ANSI/无标记。 */
function renderMd(model: TableModel): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const sep = model.aligns.map((a) => (a === "right" ? "---:" : "---"));
  const lines = [
    `| ${model.head.map(esc).join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
  ];
  for (const r of model.body) lines.push(`| ${r.cells.map(esc).join(" | ")} |`);
  if (model.total) lines.push(`| ${model.total.map(esc).join(" | ")} |`);
  return lines.join("\n");
}

/** RFC-4180 csv (REQ-007/EPIC-003)。表头=列标签小写; 不含 TOTAL (纯数据行)。 */
function renderCsv(model: TableModel): string {
  const field = (s: string) =>
    /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = [model.head.map((h) => field(h.toLowerCase())).join(",")];
  for (const r of model.body) lines.push(r.cells.map(field).join(","));
  return lines.join("\r\n");
}

/** 单一格式分发开关 (ADR-003): 加格式只动这里。 */
function format(model: TableModel, opts: RenderOpts): string {
  switch (opts.format) {
    case "json":
      return renderJson(model.data);
    case "md":
      return renderMd(model);
    case "csv":
      return renderCsv(model);
    case "table":
    default:
      return renderCliTable(model, opts);
  }
}

/** 用量行表格。columnLabel 是第一列表头 (Date / Model / Session start 等)。 */
export function renderUsageTable(
  rows: UsageRow[],
  columnLabel: string,
  opts: RenderOpts,
  bodyLimit?: number,
  includeTotal = true,
): string {
  return format(usageModel(rows, columnLabel, bodyLimit, includeTotal), opts);
}

export function renderCommandTable(
  rows: Array<{ command: string; count: number }>,
  opts: RenderOpts,
): string {
  return format(commandModel(rows), opts);
}

export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// --- 行选择 (排序/截断/翻转) — EPIC-003 / REQ-007 --------------------------

export type SortColumn = "key" | "cost" | "prompt" | "completion" | "msgs";
export const SORT_COLUMNS: readonly SortColumn[] = [
  "key",
  "cost",
  "prompt",
  "completion",
  "msgs",
];

function sortValue(r: UsageRow, col: SortColumn): number | string {
  switch (col) {
    case "key":
      return r.key;
    case "cost":
      return r.cost;
    case "prompt":
      return r.promptTokens;
    case "completion":
      return r.completionTokens;
    case "msgs":
      return r.count;
  }
}

export interface RowSelection {
  /** 显式排序列; 缺省沿用传入顺序 (各视图的默认排序)。 */
  sort?: SortColumn;
  /** 翻转最终方向。 */
  reverse?: boolean;
  /** 只显示前 N 行 (TOTAL 仍覆盖全量, 由渲染层另计)。 */
  top?: number;
}

/**
 * 纯变换 over UsageRow[] (REQ-007)。
 * 前置: sel.top 若给定为正整数。
 * 后置: 不增删 row 内容; 仅排序/截断。key 列字符串比较, 数值列数值降序 (越大越前)。
 * 显式 sort 时: key 升序; 数值列降序 (符合"最贵在前"直觉)。reverse 翻转。
 */
export function applyRowSelection(
  rows: UsageRow[],
  sel: RowSelection,
): UsageRow[] {
  let out = rows.slice();
  if (sel.sort) {
    const col = sel.sort;
    out.sort((a, b) => {
      const va = sortValue(a, col);
      const vb = sortValue(b, col);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)); // key 升序
      }
      return vb - va; // 数值降序
    });
  }
  if (sel.reverse) out.reverse();
  if (sel.top !== undefined && sel.top >= 0) out = out.slice(0, sel.top);
  return out;
}

// --- summary 渲染 (EPIC-002 / REQ-005) -------------------------------------

export interface SummaryView {
  window: { start: string | null; end: string | null; days: number };
  totals: {
    cost: number;
    promptTokens: number;
    completionTokens: number;
    count: number;
    costMissingCount: number;
  };
  topDays: UsageRow[];
  topModels: UsageRow[];
}

/**
 * 渲染 summary。table/md 出多段 (窗口头 + 合计 + Top 天/模型); json 出结构化对象。
 * csv 不适用 (多段非表格), 由 cli 层在调用前拦截。
 */
export function renderSummary(s: SummaryView, opts: RenderOpts): string {
  if (opts.format === "json") return renderJson(s);
  const md = opts.format === "md";
  const { style } = opts;

  const windowLine =
    s.window.start === null
      ? "Window: no data"
      : `Window: ${s.window.start} → ${s.window.end} (${s.window.days} day${s.window.days === 1 ? "" : "s"})`;
  const totalsLine =
    `Totals: ${formatCost(s.totals.cost)} · ` +
    `${formatTokens(s.totals.count)} messages · ` +
    `${formatTokens(s.totals.promptTokens)} prompt / ${formatTokens(s.totals.completionTokens)} completion tokens`;

  const head = (text: string) => (md ? `**${text}**` : style.bold(text));
  const section = (title: string) => (md ? `### ${title}` : `${title}:`);

  const tableOpts: RenderOpts = { ...opts, format: md ? "md" : "table" };
  // Top-N 子表是"前 N 名"清单, 不带 TOTAL 行: 真正的合计已在上方 Totals: 行,
  // 子表再放 TOTAL 只会重复且 (若 N 截断) 与全量合计矛盾。
  const parts = [
    head(windowLine),
    head(totalsLine),
    "",
    section("Top days by cost"),
    renderUsageTable(s.topDays, "Date", tableOpts, undefined, false),
    "",
    section("Top models by cost"),
    renderUsageTable(s.topModels, "Model", tableOpts, undefined, false),
  ];
  return parts.join("\n");
}
