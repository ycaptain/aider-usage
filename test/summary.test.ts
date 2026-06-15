import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildSummary } from "../src/summary.js";
import {
  applyRowSelection,
  renderSummary,
  type RenderOpts,
} from "../src/render.js";
import { identityStyle, ansiStyle } from "../src/style.js";
import type { NormalizedMessage } from "../src/types.js";
import type { UsageRow } from "../src/aggregate.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI, "");

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
function localTs(y: number, mo: number, d: number, h = 12): number {
  return Math.floor(new Date(y, mo - 1, d, h).getTime() / 1000);
}
function uRow(key: string, cost: number, count = 1): UsageRow {
  return {
    key,
    cost,
    promptTokens: count * 100,
    completionTokens: count * 50,
    count,
    costMissingCount: 0,
  };
}
function opts(over: Partial<RenderOpts> = {}): RenderOpts {
  return {
    style: identityStyle,
    format: "table",
    markers: false,
    unicode: true,
    ...over,
  };
}

describe("buildSummary (REQ-005)", () => {
  it("空输入 → window null, days 0, 全零 totals", () => {
    const s = buildSummary([], 5);
    expect(s.window).toEqual({ start: null, end: null, days: 0 });
    expect(s.totals.cost).toBe(0);
    expect(s.totals.count).toBe(0);
    expect(s.topDays).toEqual([]);
    expect(s.topModels).toEqual([]);
  });

  it("window 取 min/max time; days 含端点", () => {
    const s = buildSummary(
      [nm(localTs(2026, 6, 1), 0.1), nm(localTs(2026, 6, 3), 0.2)],
      5,
    );
    expect(s.window.start).toBe("2026-06-01");
    expect(s.window.end).toBe("2026-06-03");
    expect(s.window.days).toBe(3);
  });

  it("单条 → days=1", () => {
    expect(buildSummary([nm(localTs(2026, 6, 1), 0.1)], 5).window.days).toBe(1);
  });

  it("topModels cost 降序, 截到 N", () => {
    const s = buildSummary(
      [
        nm(100, 0.1, "a"),
        nm(200, 0.5, "b"),
        nm(300, 0.3, "c"),
        nm(400, 0.2, "d"),
      ],
      2,
    );
    expect(s.topModels.map((r) => r.key)).toEqual(["b", "c"]);
  });

  it("PBT: totals.cost == Σmessages.cost (不丢钱)", () => {
    const arb = fc.array(
      fc.record({
        time: fc.integer({ min: 1, max: 2_000_000_000 }),
        cost: fc.double({ min: 0, max: 100, noNaN: true }),
        model: fc.constantFrom("a", "b", "c"),
      }),
      { maxLength: 200 },
    );
    fc.assert(
      fc.property(arb, (raws) => {
        const msgs = raws.map((r) => nm(r.time, r.cost, r.model));
        const s = buildSummary(msgs, 5);
        expect(s.totals.cost).toBeCloseTo(
          msgs.reduce((a, m) => a + m.cost, 0),
          4,
        );
        expect(s.totals.count).toBe(msgs.length);
      }),
    );
  });
});

describe("renderSummary (REQ-005/REQ-006)", () => {
  const s = buildSummary(
    [
      nm(localTs(2026, 6, 1), 0.1, "gpt"),
      nm(localTs(2026, 6, 2), 0.5, "claude"),
    ],
    5,
  );

  it("table 含窗口头/合计/Top 段", () => {
    const out = renderSummary(s, opts());
    expect(out).toContain("Window: 2026-06-01 → 2026-06-02");
    expect(out).toContain("Totals: $0.6000");
    expect(out).toContain("Top days by cost:");
    expect(out).toContain("Top models by cost:");
  });

  it("json 出结构化对象, 零 ANSI", () => {
    const out = renderSummary(s, opts({ format: "json", style: ansiStyle }));
    const parsed = JSON.parse(out);
    expect(parsed.totals.count).toBe(2);
    expect(parsed.window.start).toBe("2026-06-01");
    expect(/\x1b\[/.test(out)).toBe(false);
  });

  it("md 出 GFM 段 (### 标题 + 表)", () => {
    const out = renderSummary(s, opts({ format: "md" }));
    expect(out).toContain("### Top days by cost");
    expect(out).toContain("| Date | Cost |");
    expect(/\x1b\[/.test(out)).toBe(false);
  });

  it("着色去 ANSI == 无色 (table)", () => {
    expect(strip(renderSummary(s, opts({ style: ansiStyle })))).toBe(
      renderSummary(s, opts({ style: identityStyle })),
    );
  });

  // 回归 (对抗审查 MUST-FIX): Top-N 子表不得带 TOTAL 行 —— 否则在 topN 截断时,
  // 子表 TOTAL (只含前 N) 会与上方 Totals: 全量合计矛盾。
  it("Top-N 子表无 TOTAL 行; 上方 Totals 仍覆盖全量 (table)", () => {
    const many = buildSummary(
      [
        nm(localTs(2026, 6, 1), 0.1, "a"),
        nm(localTs(2026, 6, 2), 0.2, "b"),
        nm(localTs(2026, 6, 3), 0.3, "c"),
        nm(localTs(2026, 6, 4), 0.4, "d"),
      ],
      2, // 截断到前 2 名
    );
    const out = renderSummary(many, opts());
    expect(out).not.toContain("TOTAL"); // 子表不再有 TOTAL 行
    expect(out).toContain("Totals: $1.0000"); // 全量合计 0.1+0.2+0.3+0.4
    expect(many.topDays).toHaveLength(2); // 确认确实截断了
  });

  it("Top-N 子表无 TOTAL 行 (md)", () => {
    const out = renderSummary(s, opts({ format: "md" }));
    expect(out).not.toContain("TOTAL");
  });
});

describe("applyRowSelection (REQ-007)", () => {
  const rows = [uRow("a", 0.1, 5), uRow("b", 0.9, 1), uRow("c", 0.3, 9)];

  it("sort cost → 降序", () => {
    expect(applyRowSelection(rows, { sort: "cost" }).map((r) => r.key)).toEqual(
      ["b", "c", "a"],
    );
  });
  it("sort key → 升序", () => {
    expect(applyRowSelection(rows, { sort: "key" }).map((r) => r.key)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("sort msgs → 降序 (count)", () => {
    expect(applyRowSelection(rows, { sort: "msgs" }).map((r) => r.key)).toEqual(
      ["c", "a", "b"],
    );
  });
  it("reverse 翻转", () => {
    expect(
      applyRowSelection(rows, { sort: "cost", reverse: true }).map(
        (r) => r.key,
      ),
    ).toEqual(["a", "c", "b"]);
  });
  it("top 截断, 不改原数组", () => {
    const sel = applyRowSelection(rows, { sort: "cost", top: 2 });
    expect(sel.map((r) => r.key)).toEqual(["b", "c"]);
    expect(rows).toHaveLength(3); // 原数组不变
  });
  it("top 0 → 空; top 超量 → 全量", () => {
    expect(applyRowSelection(rows, { top: 0 })).toHaveLength(0);
    expect(applyRowSelection(rows, { top: 99 })).toHaveLength(3);
  });
  it("无 sort → 保留原顺序 (各视图默认排序)", () => {
    expect(applyRowSelection(rows, {}).map((r) => r.key)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("PBT: 行选择不丢/不造行 (top 未给定时长度守恒)", () => {
    const arb = fc.array(
      fc.record({
        key: fc.string(),
        cost: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { maxLength: 30 },
    );
    fc.assert(
      fc.property(
        arb,
        fc.constantFrom("key", "cost", "msgs"),
        fc.boolean(),
        (raws, sort, reverse) => {
          const input = raws.map((r) => uRow(r.key, r.cost));
          const out = applyRowSelection(input, { sort: sort as any, reverse });
          expect(out).toHaveLength(input.length);
          expect(new Set(out)).toEqual(new Set(input)); // 同一批对象, 只是顺序变
        },
      ),
    );
  });
});
