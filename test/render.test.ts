import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  costTier,
  renderUsageTable,
  renderCommandTable,
  type RenderOpts,
} from "../src/render.js";
import { ansiStyle, identityStyle } from "../src/style.js";
import type { UsageRow } from "../src/aggregate.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI, "");

function row(key: string, cost: number, count = 1): UsageRow {
  return {
    key,
    cost,
    promptTokens: count * 1000,
    completionTokens: count * 500,
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

describe("costTier (REQ-002/ADR-004, BVA)", () => {
  it("maxCost≤0 守卫: 全零数据 → 全 low (不除零误标 high)", () => {
    expect(costTier(0, 0)).toBe("low");
    expect(costTier(0, -1)).toBe("low"); // 不可能但防御
  });
  it("阈值边界: 0.66/0.33·max", () => {
    const max = 1;
    expect(costTier(0.66, max)).toBe("high");
    expect(costTier(0.659, max)).toBe("mid");
    expect(costTier(0.33, max)).toBe("mid");
    expect(costTier(0.329, max)).toBe("low");
    expect(costTier(max, max)).toBe("high");
  });
  it("cost==0 始终 low, 即便 max>0", () => {
    expect(costTier(0, 10)).toBe("low");
  });

  it("PBT: tier 恒 ∈ {high,mid,low}; 且 cost==max 必 high (max>0)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (cost, max) => {
          const t = costTier(cost, max);
          expect(["high", "mid", "low"]).toContain(t);
          if (max > 0 && cost === max) expect(t).toBe("high");
          if (max <= 0) expect(t).toBe("low");
        },
      ),
    );
  });
});

describe("renderUsageTable: 着色去 ANSI == 无色 (REQ-001 关键不变量)", () => {
  it("PBT: 同 markers, 仅 style 切换 → strip(彩色) === 无色", () => {
    const arb = fc.array(
      fc.record({
        key: fc.string({ minLength: 1, maxLength: 8 }),
        cost: fc.double({ min: 0, max: 100, noNaN: true }),
        count: fc.integer({ min: 0, max: 99999 }),
      }),
      { maxLength: 20 },
    );
    fc.assert(
      fc.property(arb, fc.boolean(), (raws, markers) => {
        const rows = raws.map((r) => row(r.key, r.cost, r.count));
        const colored = renderUsageTable(
          rows,
          "Date",
          opts({ style: ansiStyle, markers }),
        );
        const plain = renderUsageTable(
          rows,
          "Date",
          opts({ style: identityStyle, markers }),
        );
        expect(strip(colored)).toBe(plain);
      }),
    );
  });

  it("无色路径零 ANSI (含 cli-table3 边框/表头)", () => {
    const rows = [row("a", 1), row("b", 0.5), row("c", 0)];
    const out = renderUsageTable(rows, "Date", opts({ style: identityStyle }));
    expect(ANSI.test(out)).toBe(false);
    ANSI.lastIndex = 0;
  });
});

describe("renderUsageTable: 标记与档位 (REQ-002)", () => {
  const rows = [row("hi", 1.0), row("md", 0.5), row("lo", 0.1)];

  it("markers=true: 每行 Cost 单元格带 ▲/=/· 固定 2 字符槽", () => {
    const out = renderUsageTable(
      rows,
      "Date",
      opts({ markers: true, unicode: true }),
    );
    expect(out).toContain("▲ $1.0000");
    expect(out).toContain("= $0.5000");
    expect(out).toContain("· $0.1000");
  });
  it("非 UTF: ASCII 降级 ^ = .", () => {
    const out = renderUsageTable(
      rows,
      "Date",
      opts({ markers: true, unicode: false }),
    );
    expect(out).toContain("^ $1.0000");
    expect(out).toContain(". $0.1000");
  });
  it("markers=false (管道): 无标记, 纯数据", () => {
    const out = renderUsageTable(rows, "Date", opts({ markers: false }));
    expect(out).not.toContain("▲");
    expect(out).not.toContain("·");
    expect(out).toContain("$1.0000");
  });
  it("TOTAL 行存在且不被分级/标记", () => {
    const out = renderUsageTable(rows, "Date", opts({ markers: true }));
    expect(out).toContain("TOTAL");
    // TOTAL 的 cost 合计 1.6, 不带标记前缀
    expect(out).toContain("$1.6000");
    expect(out).not.toContain("▲ $1.6000");
  });
  it("全零成本 → 无 high 标记 (守卫)", () => {
    const out = renderUsageTable(
      [row("a", 0), row("b", 0)],
      "Date",
      opts({ markers: true }),
    );
    expect(out).not.toContain("▲");
    expect(out).toContain("· $0.0000");
  });
  it("单行表跳过分级 → low", () => {
    const out = renderUsageTable(
      [row("only", 5)],
      "Date",
      opts({ markers: true }),
    );
    expect(out).toContain("· $5.0000");
    expect(out).not.toContain("▲");
  });
});

describe("renderUsageTable: Msgs 千位分隔 (REQ-002)", () => {
  it("count 用千位分隔", () => {
    const out = renderUsageTable([row("a", 1, 1234567)], "Date", opts());
    expect(out).toContain("1,234,567");
  });
});

describe("空状态 (REQ-003/REQ-006)", () => {
  it("table 空 → 空串 (stdout 空)", () => {
    expect(renderUsageTable([], "Date", opts())).toBe("");
  });
  it("json 空 → []", () => {
    expect(renderUsageTable([], "Date", opts({ format: "json" }))).toBe("[]");
  });
  it("md 空 → 仅表头+分隔行", () => {
    const out = renderUsageTable([], "Date", opts({ format: "md" }));
    expect(out).toBe(
      "| Date | Cost | Prompt | Completion | Msgs |\n| --- | ---: | ---: | ---: | ---: |",
    );
  });
  it("csv 空 → 仅表头行 (小写)", () => {
    expect(renderUsageTable([], "Date", opts({ format: "csv" }))).toBe(
      "date,cost,prompt,completion,msgs",
    );
  });
});

describe("renderUsageTable md/json/csv (REQ-006/REQ-007)", () => {
  const rows = [row("2026-06-01", 1.5, 1234), row("2026-06-02", 0.5, 56)];
  it("md 出合法 GFM (右对齐数字列 ---:) 且含 TOTAL", () => {
    const out = renderUsageTable(rows, "Date", opts({ format: "md" }));
    const lines = out.split("\n");
    expect(lines[0]).toBe("| Date | Cost | Prompt | Completion | Msgs |");
    expect(lines[1]).toBe("| --- | ---: | ---: | ---: | ---: |");
    expect(out).toContain("| TOTAL | $2.0000 |");
    expect(/\x1b\[/.test(out)).toBe(false);
  });
  it("json 是结构化 rows (非显示串), 零 ANSI", () => {
    const out = renderUsageTable(
      rows,
      "Date",
      opts({ format: "json", style: ansiStyle }),
    );
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].key).toBe("2026-06-01");
    expect(/\x1b\[/.test(out)).toBe(false);
  });
  it("csv 不含 TOTAL, CRLF 行分隔", () => {
    const out = renderUsageTable(rows, "Date", opts({ format: "csv" }));
    expect(out).not.toContain("TOTAL");
    expect(out.split("\r\n")).toHaveLength(3); // header + 2 rows
  });
});

describe("csv RFC-4180 转义往返 (EPIC-003 AC)", () => {
  it("PBT: 含逗号/引号/换行的 key 正确转义且可解析回原值", () => {
    fc.assert(
      fc.property(fc.string(), (key) => {
        const out = renderUsageTable(
          [row(key, 1, 1)],
          "Date",
          opts({ format: "csv" }),
        );
        const dataLine = out.split("\r\n")[1]!;
        const firstField = parseFirstCsvField(dataLine);
        expect(firstField).toBe(key);
      }),
    );
  });
});

// 最小 RFC-4180 单字段解析 (仅取第一字段, 供往返断言)
function parseFirstCsvField(line: string): string {
  if (!line.startsWith('"')) {
    const comma = line.indexOf(",");
    return comma === -1 ? line : line.slice(0, comma);
  }
  let out = "";
  let i = 1;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === '"') {
      if (line[i + 1] === '"') {
        out += '"';
        i += 2;
      } else {
        break; // 闭合引号
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

describe("renderCommandTable (REQ-004: 独立列, 不伪装 UsageRow)", () => {
  it("table 只有 Command/Count 两列, 无 cost/token 假列", () => {
    const out = renderCommandTable(
      [{ command: "command_run", count: 12 }],
      opts(),
    );
    expect(out).toContain("Command");
    expect(out).toContain("Count");
    expect(out).not.toContain("Cost");
    expect(out).not.toContain("Prompt");
  });
  it("空 commands table → 空串", () => {
    expect(renderCommandTable([], opts())).toBe("");
  });
  it("commands json 结构化", () => {
    const out = renderCommandTable(
      [{ command: "command_run", count: 3 }],
      opts({ format: "json" }),
    );
    expect(JSON.parse(out)).toEqual([{ command: "command_run", count: 3 }]);
  });
});

describe("彩色单元格对齐快照 (REQ-002/REQ-004: string-width strip 行为)", () => {
  it("高/低档着色后小数点仍对齐", () => {
    const rows = [row("alpha", 1.0, 10), row("beta", 0.0123, 200000)];
    const out = renderUsageTable(
      rows,
      "Date",
      opts({ style: ansiStyle, markers: true }),
    );
    // strip 后做列对齐快照, 颜色不应破坏 cli-table3 宽度计算
    expect(strip(out)).toMatchSnapshot();
  });
});
