import {
  type NormalizedMessage,
  type Session,
  type RawEvent,
  isCommandEvent,
} from "./types.js";

export type Period = "day" | "week" | "month";

export interface UsageRow {
  key: string;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  count: number;
  /** 该分组内 cost 缺失 (按 0 计入) 的记录数。 */
  costMissingCount: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地时区下的桶 key。week 用该周周一 (本地) 的日期。 */
export function bucketKey(time: number, period: Period): string {
  const d = new Date(time * 1000);
  if (period === "month") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (period === "day")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // week: 回退到本地周一
  const dow = (d.getDay() + 6) % 7; // 周一=0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function emptyRow(key: string): UsageRow {
  return {
    key,
    cost: 0,
    promptTokens: 0,
    completionTokens: 0,
    count: 0,
    costMissingCount: 0,
  };
}

function accumulate(row: UsageRow, m: NormalizedMessage): void {
  row.cost += m.cost;
  row.promptTokens += m.promptTokens;
  row.completionTokens += m.completionTokens;
  row.count += 1;
  if (m.costMissing) row.costMissingCount += 1;
}

function groupBy(
  messages: NormalizedMessage[],
  keyOf: (m: NormalizedMessage) => string,
): UsageRow[] {
  const map = new Map<string, UsageRow>();
  for (const m of messages) {
    const key = keyOf(m);
    let row = map.get(key);
    if (!row) {
      row = emptyRow(key);
      map.set(key, row);
    }
    accumulate(row, m);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** 不变量: Σrows.cost == Σmessages.cost (聚合不丢钱)。 */
export function byPeriod(
  messages: NormalizedMessage[],
  period: Period,
): UsageRow[] {
  return groupBy(messages, (m) => bucketKey(m.time, period));
}

export function byModel(messages: NormalizedMessage[]): UsageRow[] {
  return groupBy(messages, (m) => m.mainModel);
}

export function byEditFormat(messages: NormalizedMessage[]): UsageRow[] {
  return groupBy(messages, (m) => m.editFormat);
}

/** 从 (已按时间过滤的) 事件流统计 command_* 频率。前缀匹配, 捕获 doc 未列的命令。 */
export function countCommands(events: RawEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ev of events) {
    if (isCommandEvent(ev.event)) {
      counts[ev.event] = (counts[ev.event] ?? 0) + 1;
    }
  }
  return counts;
}

/** 命令频率: 把计数转成排序行 (按频次降序)。 */
export function commandRows(
  counts: Record<string, number>,
): Array<{ command: string; count: number }> {
  return Object.entries(counts)
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

/** 本地时区 "YYYY-MM-DD HH:mm" (session key 用, 与其它聚合的本地时区一致)。 */
function localDateTime(time: number): string {
  const d = new Date(time * 1000);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** session 汇总行 (按成本降序, 用于 "最贵的 session")。 */
export function sessionRows(sessions: Session[]): UsageRow[] {
  return sessions
    .map((s) => ({
      key: localDateTime(s.startTime),
      cost: s.cost,
      promptTokens: s.promptTokens,
      completionTokens: s.completionTokens,
      count: s.messages.length,
      costMissingCount: s.messages.filter((m) => m.costMissing).length,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/** 全局 cost 缺失计数 (渲染脚注用)。 */
export function totalMissingCost(messages: NormalizedMessage[]): number {
  return messages.filter((m) => m.costMissing).length;
}
