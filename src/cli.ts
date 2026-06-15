#!/usr/bin/env node
import { Command } from "commander";
import { discoverLogPath, type LogLocation } from "./config.js";
import { readEvents, toNormalizedMessage } from "./reader.js";
import { filterByRange, localDayStart, localDayEnd } from "./filter.js";
import { sessionize } from "./sessionize.js";
import {
  byPeriod,
  byModel,
  commandRows,
  countCommands,
  sessionRows,
  type Period,
  type UsageRow,
} from "./aggregate.js";
import {
  renderUsageTable,
  renderCommandTable,
  renderJson,
  renderSummary,
  applyRowSelection,
  SORT_COLUMNS,
  type RenderOpts,
  type RowSelection,
  type SortColumn,
} from "./render.js";
import { buildSummary } from "./summary.js";
import { runSetup } from "./setup.js";
import {
  resolveColor,
  type ColorOpts,
  type ColorWhen,
  type Format,
} from "./capability.js";
import { makeStyle, identityStyle, type Style } from "./style.js";
import {
  MESSAGE_SEND_EVENT,
  type NormalizedMessage,
  type RawEvent,
} from "./types.js";

interface GlobalOpts {
  since?: string;
  until?: string;
  json?: boolean;
  format?: string;
  /** commander: undefined=未给, string=--color <when>, false=--no-color。 */
  color?: string | false;
  top?: string;
  sort?: string;
  reverse?: boolean;
}

const FORMATS: readonly Format[] = ["table", "json", "md", "csv"];
const DEFAULT_TOP = 5;

// --- 消息流纪律 (REQ-003): 数据→stdout, note/error→stderr ---------------------

/** stderr 文案着色用; 每次 prelude 解析后设置。 */
let msgStyle: Style = identityStyle;

function emitError(msg: string): never {
  process.stderr.write(`${msgStyle.error(`error: ${msg}`)}\n`);
  process.exit(1);
}
function emitNote(msg: string): void {
  process.stderr.write(`${msgStyle.dim(`note: ${msg}`)}\n`);
}
function emitStdout(out: string): void {
  if (out.length > 0) process.stdout.write(`${out}\n`);
}

// --- 选项解析 (prelude) -------------------------------------------------------

function rawColorFlags(opts: GlobalOpts): ColorOpts {
  if (opts.color === false) return { noColor: true };
  if (typeof opts.color === "string") return { color: opts.color as ColorWhen };
  return {};
}

interface Ctx {
  format: Format;
  renderOpts: RenderOpts;
  selection: RowSelection;
  /** summary 的 Top-N (来自 --top, 默认 5)。 */
  summaryTopN: number;
}

/** 校验 + 解析全局选项; 副作用: 设置 msgStyle。校验失败 → emitError(exit 1)。 */
function prelude(opts: GlobalOpts): Ctx {
  // 1. 先定 stderr 文案样式 (据 --color flag, 与格式无关), 以便后续错误可着色。
  msgStyle = makeStyle(
    resolveColor(process.env, rawColorFlags(opts), process.stderr),
  );

  // 2. 校验 --color 值。
  if (
    typeof opts.color === "string" &&
    !["auto", "always", "never"].includes(opts.color)
  ) {
    emitError(
      `unknown --color value "${opts.color}". use one of auto, always, never.`,
    );
  }

  // 3. 格式 (--json 是 --format json 的简写)。
  const format: Format = resolveFormat(opts);

  // 4. 排序/截断。
  const selection = resolveSelection(opts);

  // 5. stdout 渲染能力 (与格式相关: 机读强制零着色/零标记)。
  const cap = resolveColor(
    process.env,
    { ...rawColorFlags(opts), format },
    process.stdout,
  );
  const renderOpts: RenderOpts = {
    style: makeStyle(cap),
    format,
    markers: cap.markers,
    unicode: cap.unicode,
  };

  const summaryTopN = selection.top !== undefined ? selection.top : DEFAULT_TOP;

  return { format, renderOpts, selection, summaryTopN };
}

function resolveFormat(opts: GlobalOpts): Format {
  if (opts.json) return "json";
  const f = (opts.format ?? "table") as Format;
  if (!FORMATS.includes(f)) {
    emitError(
      `unknown format "${opts.format}". use one of ${FORMATS.join(", ")}.`,
    );
  }
  return f;
}

function resolveSelection(opts: GlobalOpts): RowSelection {
  const sel: RowSelection = {};
  if (opts.sort !== undefined) {
    if (!SORT_COLUMNS.includes(opts.sort as SortColumn)) {
      emitError(
        `unknown sort column "${opts.sort}". use one of ${SORT_COLUMNS.join(", ")}.`,
      );
    }
    sel.sort = opts.sort as SortColumn;
  }
  if (opts.reverse) sel.reverse = true;
  if (opts.top !== undefined) {
    // 严格十进制整数: 拒绝 1e1 / 0x5 / 空格填充 / 小数 / 负号。
    if (!/^\d+$/.test(opts.top)) {
      emitError(
        `invalid --top value "${opts.top}". expected a non-negative integer.`,
      );
    }
    sel.top = Number(opts.top);
  }
  return sel;
}

// --- 加载 ---------------------------------------------------------------------

function printGuidance(loc: LogLocation): void {
  if (loc.found) return;
  if (loc.reason === "file-missing") {
    emitErrorMessage(
      `analytics log not found at ${loc.path}. run aider at least once to create it, or run: aider-usage setup`,
    );
  } else {
    emitErrorMessage(
      `no analytics log configured. add 'analytics-log: ~/.aider/analytics.jsonl' to ~/.aider.conf.yml, or run: aider-usage setup`,
    );
  }
}
/** 非中止式 error 行 (调用方负责 exit code)。 */
function emitErrorMessage(msg: string): void {
  process.stderr.write(`${msgStyle.error(`error: ${msg}`)}\n`);
}

/** 解析并校验时间窗。返回 unix 秒边界; 非法 → emitError(exit 1)。 */
function resolveRange(opts: GlobalOpts): {
  since: number | undefined;
  until: number | undefined;
} {
  let since: number | undefined;
  let until: number | undefined;
  if (opts.since !== undefined) {
    const s = localDayStart(opts.since);
    if (s === null) {
      emitError(`invalid --since date "${opts.since}". expected YYYY-MM-DD.`);
    }
    since = s;
  }
  if (opts.until !== undefined) {
    const u = localDayEnd(opts.until);
    if (u === null) {
      emitError(`invalid --until date "${opts.until}". expected YYYY-MM-DD.`);
    }
    until = u;
  }
  if (since !== undefined && until !== undefined && since > until) {
    emitError(
      `--since (${opts.since}) is after --until (${opts.until}). swap them or widen the range.`,
    );
  }
  return { since, until };
}

interface Loaded {
  messages: NormalizedMessage[];
  events: RawEvent[];
  skipped: number;
}

/** 发现 -> 读 -> 排序 -> 过滤 -> 归一。找不到日志返回 null (调用方 exit 1)。 */
async function load(opts: GlobalOpts): Promise<Loaded | null> {
  const loc = discoverLogPath();
  if (!loc.found) {
    printGuidance(loc);
    return null;
  }
  const { since, until } = resolveRange(opts);
  const { events, skipped } = await readEvents(loc.path);
  events.sort((a, b) => a.time - b.time);
  const filtered = filterByRange(events, since, until);
  const messages = filtered
    .filter((e) => e.event === MESSAGE_SEND_EVENT)
    .map(toNormalizedMessage);
  if (skipped > 0) {
    emitNote(`skipped ${skipped} malformed line(s). they were ignored.`);
  }
  return { messages, events: filtered, skipped };
}

function windowLabel(opts: GlobalOpts): string {
  if (opts.since === undefined && opts.until === undefined) return "all dates";
  return `${opts.since ?? "(earliest)"}..${opts.until ?? "(latest)"}`;
}

// --- 视图发射 -----------------------------------------------------------------

/** 用量视图: 排序 → note(top/empty/missing) → 渲染。TOTAL 始终覆盖全量。 */
function emitUsage(
  rows: UsageRow[],
  label: string,
  ctx: Ctx,
  opts: GlobalOpts,
): void {
  const sorted = applyRowSelection(rows, {
    ...(ctx.selection.sort ? { sort: ctx.selection.sort } : {}),
    ...(ctx.selection.reverse ? { reverse: true } : {}),
  });
  const total = sorted.length;
  const limit = ctx.selection.top;
  if (limit !== undefined && limit < total) {
    emitNote(`showing top ${limit} of ${total} rows. TOTAL covers all.`);
  }
  if (total === 0) {
    emitNote(
      `no usage found in range ${windowLabel(opts)}. widen --since/--until or run aider to generate data.`,
    );
  }
  const missing = rows.reduce((a, r) => a + r.costMissingCount, 0);
  if (missing > 0) {
    emitNote(
      `${missing} record(s) had no cost data, counted as $0. cost totals may be understated.`,
    );
  }
  emitStdout(renderUsageTable(sorted, label, ctx.renderOpts, limit));
}

function periodAction(period: Period) {
  return async () => {
    const opts = program.opts<GlobalOpts>();
    const ctx = prelude(opts);
    const data = await load(opts);
    if (!data) process.exit(1);
    emitUsage(byPeriod(data.messages, period), "Date", ctx, opts);
  };
}

// --- 命令 ---------------------------------------------------------------------

const program = new Command();
program
  .name("aider-usage")
  .description("Offline token/cost usage reports from Aider analytics logs")
  .version("0.1.0")
  .option("--since <date>", "start date YYYY-MM-DD (local, inclusive)")
  .option("--until <date>", "end date YYYY-MM-DD (local, inclusive)")
  .option(
    "-f, --format <fmt>",
    "output format: table|json|md|csv (default table)",
  )
  .option("--json", "shorthand for --format json")
  .option("--color <when>", "colorize: auto|always|never (default auto)")
  .option("--no-color", "disable color (alias for --color never)")
  .option("--top <n>", "show only the top N rows (TOTAL still covers all)")
  .option("--sort <col>", `sort by column: ${SORT_COLUMNS.join("|")}`)
  .option("--reverse", "reverse the sort direction");

program
  .command("summary", { isDefault: true })
  .description("overview: active window, totals, and top days/models by cost")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const ctx = prelude(opts);
    if (ctx.format === "csv") {
      emitError(
        "csv is not supported for summary. use --format json for structured summary data.",
      );
    }
    // summary 的子表语义固定 (cost 降序), --sort/--reverse 不适用 —— 显式报错而非静默忽略。
    if (ctx.selection.sort !== undefined || ctx.selection.reverse) {
      emitError(
        "--sort/--reverse do not apply to summary. use daily/weekly/monthly/models/session/commands for custom ordering.",
      );
    }
    const data = await load(opts);
    if (!data) process.exit(1);
    const summary = buildSummary(data.messages, ctx.summaryTopN);
    if (summary.totals.count === 0) {
      emitNote(
        `no usage found in range ${windowLabel(opts)}. widen --since/--until or run aider to generate data.`,
      );
    }
    if (summary.totals.costMissingCount > 0) {
      emitNote(
        `${summary.totals.costMissingCount} record(s) had no cost data, counted as $0. cost totals may be understated.`,
      );
    }
    emitStdout(renderSummary(summary, ctx.renderOpts));
  });

program
  .command("daily")
  .description("usage grouped by day (sorted by date, ascending)")
  .action(periodAction("day"));
program
  .command("weekly")
  .description("usage grouped by week (sorted by week start, ascending)")
  .action(periodAction("week"));
program
  .command("monthly")
  .description("usage grouped by month (sorted by month, ascending)")
  .action(periodAction("month"));

program
  .command("models")
  .description("usage grouped by model (sorted by model name, ascending)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const ctx = prelude(opts);
    const data = await load(opts);
    if (!data) process.exit(1);
    emitUsage(byModel(data.messages), "Model", ctx, opts);
  });

program
  .command("session")
  .description(
    "usage grouped by inferred session (sorted by cost, most expensive first)",
  )
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const ctx = prelude(opts);
    const data = await load(opts);
    if (!data) process.exit(1);
    if (opts.since !== undefined || opts.until !== undefined) {
      emitNote(
        "sessions are inferred within the date range. processes crossing the boundary may be split.",
      );
    }
    emitUsage(sessionRows(sessionize(data.events)), "Session start", ctx, opts);
  });

program
  .command("commands")
  .description(
    "frequency of aider slash-commands (sorted by count, descending; unique to aider-usage)",
  )
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const ctx = prelude(opts);
    const data = await load(opts);
    if (!data) process.exit(1);
    const rows = commandRows(countCommands(data.events));
    if (rows.length === 0) {
      emitNote(`no slash-commands recorded in range ${windowLabel(opts)}.`);
    }
    emitStdout(renderCommandTable(rows, ctx.renderOpts));
  });

program
  .command("setup")
  .description("write analytics-log config to ~/.aider.conf.yml")
  .action(() => {
    const result = runSetup();
    if (result.action === "already-present") {
      emitStdout(`analytics-log already configured in ${result.confPath}`);
    } else {
      emitStdout(`${result.action} config in ${result.confPath}`);
      emitStdout(`  analytics-log: ${result.logPath}`);
    }
    emitStdout("run aider as usual; logs will accumulate automatically.");
  });

program.addHelpText(
  "after",
  `
Examples:
  $ aider-usage                      overview (default)
  $ aider-usage daily --since 2026-06-01
  $ aider-usage models --sort cost --top 5
  $ aider-usage monthly --format md  > report.md
  $ aider-usage session --json | jq '.[0]'
`,
);

program.parseAsync(process.argv);
