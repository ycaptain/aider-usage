import type { RawEvent } from "./types.js";

/** 把 "YYYY-MM-DD" 解析为本地时区当天 00:00:00 的 unix 秒。非法返回 null。 */
export function localDayStart(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; // 拒绝 2026-02-31 之类
  return Math.floor(dt.getTime() / 1000);
}

/** 把 "YYYY-MM-DD" 解析为本地时区当天 23:59:59 的 unix 秒 (闭区间右端)。 */
export function localDayEnd(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return Math.floor(dt.getTime() / 1000);
}

/**
 * 本地时区闭区间过滤 [since 00:00, until 23:59:59]。
 * 契约: 前置 = since<=until (cli 层已挡 since>until 并报错); 后置 = 输出是输入子集, 保序。
 */
export function filterByRange(
  events: RawEvent[],
  since?: number,
  until?: number,
): RawEvent[] {
  return events.filter(
    (e) =>
      (since === undefined || e.time >= since) &&
      (until === undefined || e.time <= until),
  );
}
