import Table from "cli-table3";
import type { UsageRow } from "./aggregate.js";

export function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** 用量行表格。columnLabel 是第一列表头 (Date / Model / EditFormat 等)。 */
export function renderUsageTable(
  rows: UsageRow[],
  columnLabel: string,
): string {
  const table = new Table({
    head: [columnLabel, "Cost", "Prompt", "Completion", "Msgs"],
    colAligns: ["left", "right", "right", "right", "right"],
  });
  let totalCost = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCount = 0;
  let missing = 0;
  for (const r of rows) {
    table.push([
      r.key,
      formatCost(r.cost),
      formatTokens(r.promptTokens),
      formatTokens(r.completionTokens),
      String(r.count),
    ]);
    totalCost += r.cost;
    totalPrompt += r.promptTokens;
    totalCompletion += r.completionTokens;
    totalCount += r.count;
    missing += r.costMissingCount;
  }
  if (rows.length > 0) {
    table.push([
      "TOTAL",
      formatCost(totalCost),
      formatTokens(totalPrompt),
      formatTokens(totalCompletion),
      String(totalCount),
    ]);
  }
  let out = rows.length === 0 ? "(no data in range)" : table.toString();
  if (missing > 0) {
    out += `\nnote: ${missing} record(s) had no cost data (counted as $0).`;
  }
  return out;
}

export function renderCommandTable(
  rows: Array<{ command: string; count: number }>,
): string {
  if (rows.length === 0) return "(no commands recorded)";
  const table = new Table({
    head: ["Command", "Count"],
    colAligns: ["left", "right"],
  });
  for (const r of rows) table.push([r.command, String(r.count)]);
  return table.toString();
}

export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
