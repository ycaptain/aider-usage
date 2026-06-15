#!/usr/bin/env node
import { Command } from "commander";
import { discoverLogPath, type LogLocation } from "./config.js";
import { readEvents } from "./reader.js";
import { toNormalizedMessage } from "./reader.js";
import { filterByRange, localDayStart, localDayEnd } from "./filter.js";
import { sessionize } from "./sessionize.js";
import {
  byPeriod,
  byModel,
  commandRows,
  countCommands,
  sessionRows,
  type Period,
} from "./aggregate.js";
import { renderUsageTable, renderCommandTable, renderJson } from "./render.js";
import { runSetup } from "./setup.js";
import {
  MESSAGE_SEND_EVENT,
  type NormalizedMessage,
  type RawEvent,
} from "./types.js";

interface GlobalOpts {
  since?: string;
  until?: string;
  json?: boolean;
}

function printGuidance(loc: LogLocation): void {
  const reason = loc.found ? "" : loc.reason;
  console.error("aider-usage: no analytics log found.");
  if (reason === "file-missing") {
    console.error(`  configured path does not exist yet: ${loc.path}`);
    console.error("  run aider at least once to generate it.");
  } else {
    console.error("  add this line to ~/.aider.conf.yml:");
    console.error("");
    console.error("    analytics-log: ~/.aider/analytics.jsonl");
    console.error("");
    console.error("  or run:  aider-usage setup");
  }
}

/** 解析并校验时间窗。since>until 抛错 (你的决策)。返回 unix 秒边界。 */
function resolveRange(opts: GlobalOpts): {
  since: number | undefined;
  until: number | undefined;
} {
  let since: number | undefined;
  let until: number | undefined;
  if (opts.since !== undefined) {
    const s = localDayStart(opts.since);
    if (s === null) {
      console.error(
        `invalid --since date: ${opts.since} (expected YYYY-MM-DD)`,
      );
      process.exit(1);
    }
    since = s;
  }
  if (opts.until !== undefined) {
    const u = localDayEnd(opts.until);
    if (u === null) {
      console.error(
        `invalid --until date: ${opts.until} (expected YYYY-MM-DD)`,
      );
      process.exit(1);
    }
    until = u;
  }
  if (since !== undefined && until !== undefined && since > until) {
    console.error(`--since (${opts.since}) is after --until (${opts.until})`);
    process.exit(1);
  }
  return { since, until };
}

interface Loaded {
  messages: NormalizedMessage[];
  /** 已按时间过滤的事件流 (含 message_send/session/command_*)。 */
  events: RawEvent[];
  skipped: number;
}

/** 发现 -> 读 -> 排序 -> 过滤 -> 归一。找不到日志返回 null (调用方走引导)。 */
async function load(opts: GlobalOpts): Promise<Loaded | null> {
  const loc = discoverLogPath();
  if (!loc.found) {
    printGuidance(loc);
    return null;
  }
  const { since, until } = resolveRange(opts);
  const { events, skipped } = await readEvents(loc.path);
  // 样本可能乱序: 聚合/推断前必须按 time 排序
  events.sort((a, b) => a.time - b.time);
  const filtered = filterByRange(events, since, until);
  const messages = filtered
    .filter((e) => e.event === MESSAGE_SEND_EVENT)
    .map(toNormalizedMessage);
  if (skipped > 0) {
    console.error(`note: skipped ${skipped} malformed line(s).`);
  }
  return { messages, events: filtered, skipped };
}

const program = new Command();
program
  .name("aider-usage")
  .description("Offline token/cost usage reports from Aider analytics logs")
  .version("0.1.0")
  .option("--since <date>", "start date YYYY-MM-DD (local, inclusive)")
  .option("--until <date>", "end date YYYY-MM-DD (local, inclusive)")
  .option("--json", "output JSON instead of a table");

function periodAction(period: Period) {
  return async () => {
    const opts = program.opts<GlobalOpts>();
    const data = await load(opts);
    if (!data) process.exit(0);
    const rows = byPeriod(data.messages, period);
    console.log(opts.json ? renderJson(rows) : renderUsageTable(rows, "Date"));
  };
}

program
  .command("daily")
  .description("usage grouped by day")
  .action(periodAction("day"));
program
  .command("weekly")
  .description("usage grouped by week")
  .action(periodAction("week"));
program
  .command("monthly")
  .description("usage grouped by month")
  .action(periodAction("month"));

program
  .command("models")
  .description("usage grouped by model")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const data = await load(opts);
    if (!data) process.exit(0);
    const rows = byModel(data.messages);
    console.log(opts.json ? renderJson(rows) : renderUsageTable(rows, "Model"));
  });

program
  .command("session")
  .description("usage grouped by inferred session (most expensive first)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const data = await load(opts);
    if (!data) process.exit(0);
    if (opts.since !== undefined || opts.until !== undefined) {
      // session 在已过滤的子集上推断: 跨时间窗边界的进程会被截断/拆分。
      console.error(
        "note: sessions are inferred within the date range; processes crossing the boundary may be split.",
      );
    }
    const sessions = sessionize(data.events);
    const rows = sessionRows(sessions);
    console.log(
      opts.json ? renderJson(rows) : renderUsageTable(rows, "Session start"),
    );
  });

program
  .command("commands")
  .description("frequency of aider slash-commands (unique to aider-usage)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const data = await load(opts);
    if (!data) process.exit(0);
    const rows = commandRows(countCommands(data.events));
    console.log(opts.json ? renderJson(rows) : renderCommandTable(rows));
  });

program
  .command("setup")
  .description("write analytics-log config to ~/.aider.conf.yml")
  .action(() => {
    const result = runSetup();
    if (result.action === "already-present") {
      console.log(`analytics-log already configured in ${result.confPath}`);
    } else {
      console.log(`${result.action} config in ${result.confPath}`);
      console.log(`  analytics-log: ${result.logPath}`);
    }
    console.log("run aider as usual; logs will accumulate automatically.");
  });

// 裸命令默认走 daily
program.action(periodAction("day"));

program.parseAsync(process.argv);
