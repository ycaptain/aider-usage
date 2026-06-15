/**
 * summary 总览计算 (REQ-005 / ADR-005)。
 *
 * 活动窗口的 min/max 需新增一趟对 messages[].time 的扫描 (UsageRow 不带时间戳),
 * 复用已加载数据, 无额外 I/O (NFR-P-001)。
 */

import type { NormalizedMessage } from "./types.js";
import { byPeriod, byModel, type UsageRow } from "./aggregate.js";

export interface Summary {
  /** 活动窗口: 数据实际跨度 (经 --since/--until 过滤后的 min/max)。 */
  window: { start: string | null; end: string | null; days: number };
  totals: {
    cost: number;
    promptTokens: number;
    completionTokens: number;
    count: number;
    costMissingCount: number;
  };
  /** 花费最高的 N 天 (cost 降序)。 */
  topDays: UsageRow[];
  /** 花费最高的 N 个模型 (cost 降序)。 */
  topModels: UsageRow[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDate(time: number): string {
  const d = new Date(time * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 含端点的本地日历天数 (跨 N 天)。 */
function inclusiveDays(minTime: number, maxTime: number): number {
  const a = new Date(minTime * 1000);
  const b = new Date(maxTime * 1000);
  const aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((bMid - aMid) / 86_400_000) + 1;
}

const byCostDesc = (a: UsageRow, b: UsageRow): number =>
  b.cost - a.cost || a.key.localeCompare(b.key);

/**
 * 由 messages 构建总览。
 * 前置: messages 已按目标时间窗过滤。
 * 后置: window 取 messages min/max time; 空输入 → start/end=null, days=0, 全零 totals。
 * 不变量: totals.cost == Σmessages.cost (与 byPeriod/byModel 同源, 不丢钱)。
 */
export function buildSummary(
  messages: NormalizedMessage[],
  topN: number,
): Summary {
  const totals = {
    cost: 0,
    promptTokens: 0,
    completionTokens: 0,
    count: messages.length,
    costMissingCount: 0,
  };
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const m of messages) {
    totals.cost += m.cost;
    totals.promptTokens += m.promptTokens;
    totals.completionTokens += m.completionTokens;
    if (m.costMissing) totals.costMissingCount += 1;
    if (m.time < minTime) minTime = m.time;
    if (m.time > maxTime) maxTime = m.time;
  }

  const window =
    messages.length === 0
      ? { start: null, end: null, days: 0 }
      : {
          start: localDate(minTime),
          end: localDate(maxTime),
          days: inclusiveDays(minTime, maxTime),
        };

  const topDays = byPeriod(messages, "day")
    .slice()
    .sort(byCostDesc)
    .slice(0, topN);
  const topModels = byModel(messages).slice().sort(byCostDesc).slice(0, topN);

  return { window, totals, topDays, topModels };
}
