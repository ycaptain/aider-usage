import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { byPeriod, byModel } from "../src/aggregate.js";
import { localDayStart, localDayEnd, filterByRange } from "../src/filter.js";
import type { NormalizedMessage, RawEvent } from "../src/types.js";

function nm(time: number, cost: number, model = "m"): NormalizedMessage {
  return {
    time,
    mainModel: model,
    editFormat: "diff",
    promptTokens: 10,
    completionTokens: 5,
    cost,
    costMissing: false,
    totalCost: cost,
  };
}
// 用本地时区构造确定的时间戳, 避免测试随 TZ 漂移
function localTs(y: number, mo: number, d: number, h = 12): number {
  return Math.floor(new Date(y, mo - 1, d, h).getTime() / 1000);
}

describe("filter 时区与区间 (BVA)", () => {
  it("非法日期返回 null (2026-02-31 / 乱格式)", () => {
    expect(localDayStart("2026-02-31")).toBeNull();
    expect(localDayStart("not-a-date")).toBeNull();
  });

  it("闭区间: time==sinceStart 含, time==untilEnd 含, 端点外排除", () => {
    const start = localDayStart("2026-03-10")!;
    const end = localDayEnd("2026-03-10")!;
    const evs: RawEvent[] = [
      { event: "x", properties: {}, user_id: "u", time: start }, // 含
      { event: "x", properties: {}, user_id: "u", time: end }, // 含
      { event: "x", properties: {}, user_id: "u", time: start - 1 }, // 排除
      { event: "x", properties: {}, user_id: "u", time: end + 1 }, // 排除
    ];
    expect(filterByRange(evs, start, end)).toHaveLength(2);
  });
});

describe("aggregate 分桶 (BVA)", () => {
  it("同一天合并为一行并求和", () => {
    const rows = byPeriod(
      [nm(localTs(2026, 3, 10, 9), 0.01), nm(localTs(2026, 3, 10, 18), 0.02)],
      "day",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost).toBeCloseTo(0.03, 6);
    expect(rows[0]!.count).toBe(2);
  });

  it("跨月边界: 1/31 与 2/1 分两个 month 桶且升序", () => {
    const rows = byPeriod(
      [nm(localTs(2026, 2, 1, 12), 0.02), nm(localTs(2026, 1, 31, 12), 0.01)],
      "month",
    );
    expect(rows.map((r) => r.key)).toEqual(["2026-01", "2026-02"]);
  });

  it("空集 -> 空数组; 单条 -> 单行", () => {
    expect(byPeriod([], "day")).toEqual([]);
    expect(byPeriod([nm(localTs(2026, 3, 10), 0.01)], "day")).toHaveLength(1);
  });

  it("按模型分组", () => {
    const rows = byModel([
      nm(100, 0.01, "gpt-4"),
      nm(200, 0.02, "claude"),
      nm(300, 0.03, "gpt-4"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === "gpt-4")!.count).toBe(2);
  });
});

describe("aggregate 不变量 (PBT: 聚合不丢钱)", () => {
  const msgArb = fc.record({
    time: fc.integer({ min: 0, max: 2_000_000_000 }),
    cost: fc.double({ min: 0, max: 100, noNaN: true }),
    model: fc.constantFrom("gpt-4", "claude", "gemini"),
  });

  it.each(["day", "week", "month"] as const)(
    "byPeriod(%s): Σrows.cost == Σinput.cost",
    (period) => {
      fc.assert(
        fc.property(fc.array(msgArb, { maxLength: 300 }), (raws) => {
          const msgs = raws.map((r) => nm(r.time, r.cost, r.model));
          const total = msgs.reduce((s, m) => s + m.cost, 0);
          const rows = byPeriod(msgs, period);
          const summed = rows.reduce((s, r) => s + r.cost, 0);
          expect(summed).toBeCloseTo(total, 4);
        }),
      );
    },
  );
});
