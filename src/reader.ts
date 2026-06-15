import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  type RawEvent,
  type NormalizedMessage,
  MESSAGE_SEND_EVENT,
  isCommandEvent,
} from "./types.js";

/**
 * 解析单行 JSONL -> RawEvent。
 * 契约: 前置 = 单行字符串; 后置 = 合法 RawEvent 或 null; 不变量 = 永不抛异常。
 * 合法判据: 顶层是对象, event 是字符串, time 是有限数。properties 缺失归一为 {}。
 */
export function parseLine(line: string): RawEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof obj !== "object" || obj === null || Array.isArray(obj))
    return null;

  const rec = obj as Record<string, unknown>;
  if (typeof rec.event !== "string") return null;
  if (typeof rec.time !== "number" || !Number.isFinite(rec.time)) return null;

  const properties =
    typeof rec.properties === "object" &&
    rec.properties !== null &&
    !Array.isArray(rec.properties)
      ? (rec.properties as Record<string, unknown>)
      : {};

  return {
    event: rec.event,
    properties,
    user_id: typeof rec.user_id === "string" ? rec.user_id : "",
    time: rec.time,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * 归一 message_send。cost 缺失/null/非数值 -> cost=0, costMissing=true;
 * 真实的 cost===0 -> costMissing=false。此判定是唯一一处 (非冗余原则), 下游不再判 null。
 */
export function toNormalizedMessage(ev: RawEvent): NormalizedMessage {
  const p = ev.properties;
  const costRaw = p.cost;
  const costMissing = !(
    typeof costRaw === "number" && Number.isFinite(costRaw)
  );
  return {
    time: ev.time,
    mainModel: str(p.main_model, "unknown"),
    editFormat: str(p.edit_format, "unknown"),
    promptTokens: num(p.prompt_tokens, 0),
    completionTokens: num(p.completion_tokens, 0),
    cost: costMissing ? 0 : (costRaw as number),
    costMissing,
    totalCost: num(p.total_cost, 0),
  };
}

/** reader 产出: 排序就绪的相关事件 + 跳过计数。 */
export interface ReadResult {
  /**
   * message_send、session 信号、command_* 事件 (全部带 time, 未排序)。
   * command 事件保留进流以便下游按时间过滤后再计数 (不能在读取阶段就丢弃 time)。
   */
  events: RawEvent[];
  /** 解析失败被跳过的行数。 */
  skipped: number;
}

/**
 * 流式逐行读取日志。
 * 契约: 前置 = path 文件存在 (config 层保证); 不变量 = command_* 仅计数不驻留。
 * 注意: events 仍全量驻留, 因 sessionize 需排序 + 看相邻行。日志通常不大, 属合理取舍。
 */
export async function readEvents(path: string): Promise<ReadResult> {
  const events: RawEvent[] = [];
  let skipped = 0;

  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim() === "") continue;
    const ev = parseLine(line);
    if (ev === null) {
      skipped++;
      continue;
    }
    // 保留用量、session 信号与命令事件; 丢弃其余 (launched/repo/...) 以省内存。
    if (
      ev.event === MESSAGE_SEND_EVENT ||
      ev.event.endsWith("session") ||
      isCommandEvent(ev.event)
    ) {
      events.push(ev);
    }
  }

  return { events, skipped };
}
