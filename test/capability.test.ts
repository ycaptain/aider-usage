import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  resolveColor,
  type ColorOpts,
  type Format,
} from "../src/capability.js";
import { ansiStyle, identityStyle, makeStyle } from "../src/style.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI, "");

describe("resolveColor 优先级 (REQ-001, 决策表)", () => {
  // [name, env, opts, stream, expectedColorEnabled]
  const cases: Array<
    [string, NodeJS.ProcessEnv, ColorOpts, { isTTY?: boolean }, boolean]
  > = [
    ["TTY + auto → on", {}, { color: "auto" }, { isTTY: true }, true],
    ["非 TTY + auto → off", {}, { color: "auto" }, { isTTY: false }, false],
    ["缺省 color 视为 auto, TTY → on", {}, {}, { isTTY: true }, true],
    ["--no-color 压过 TTY", {}, { noColor: true }, { isTTY: true }, false],
    [
      "always 压过非 TTY (管道强制上色)",
      {},
      { color: "always" },
      { isTTY: false },
      true,
    ],
    [
      "always 压过 NO_COLOR",
      { NO_COLOR: "1" },
      { color: "always" },
      { isTTY: true },
      true,
    ],
    ["never 压过 TTY", {}, { color: "never" }, { isTTY: true }, false],
    [
      "NO_COLOR(空串也算) 压过 TTY (auto)",
      { NO_COLOR: "" },
      { color: "auto" },
      { isTTY: true },
      false,
    ],
    ["TERM=dumb 压过 TTY (auto)", { TERM: "dumb" }, {}, { isTTY: true }, false],
    [
      "机读 json 永远 off, 无视 always",
      {},
      { color: "always", format: "json" },
      { isTTY: true },
      false,
    ],
    ["机读 md 永远 off", {}, { format: "md" }, { isTTY: true }, false],
    [
      "机读 csv 永远 off, 无视 always",
      {},
      { color: "always", format: "csv" },
      { isTTY: true },
      false,
    ],
  ];
  it.each(cases)("%s", (_name, env, opts, stream, expected) => {
    expect(resolveColor(env, opts, stream).colorEnabled).toBe(expected);
  });
});

describe("resolveColor markers (REQ-002: 仅 TTY 上的 table)", () => {
  it("TTY + table → markers on (即便无色)", () => {
    const cap = resolveColor(
      { NO_COLOR: "1" },
      { format: "table" },
      { isTTY: true },
    );
    expect(cap.colorEnabled).toBe(false);
    expect(cap.markers).toBe(true); // 无色 TTY 保留标记 = 唯一档位信号
  });
  it("管道 (非 TTY) → markers off (纯数据)", () => {
    expect(
      resolveColor({}, { format: "table" }, { isTTY: false }).markers,
    ).toBe(false);
  });
  it("管道 + --color always → markers on (强制装饰, mid 也可辨)", () => {
    const cap = resolveColor(
      {},
      { format: "table", color: "always" },
      { isTTY: false },
    );
    expect(cap.colorEnabled).toBe(true);
    expect(cap.markers).toBe(true);
  });
  it("机读 + --color always → markers 仍 off (机读零装饰)", () => {
    expect(
      resolveColor({}, { format: "json", color: "always" }, { isTTY: false })
        .markers,
    ).toBe(false);
  });
  it("机读格式 → markers off, 即便 TTY", () => {
    expect(resolveColor({}, { format: "json" }, { isTTY: true }).markers).toBe(
      false,
    );
    expect(resolveColor({}, { format: "md" }, { isTTY: true }).markers).toBe(
      false,
    );
  });
});

describe("resolveColor unicode 探测 (locale)", () => {
  it("LANG 含 UTF-8 → unicode", () => {
    expect(resolveColor({ LANG: "en_US.UTF-8" }, {}, {}).unicode).toBe(true);
  });
  it("LC_ALL=C → ASCII 降级", () => {
    expect(resolveColor({ LC_ALL: "C" }, {}, {}).unicode).toBe(false);
  });
  it("POSIX → ASCII", () => {
    expect(resolveColor({ LANG: "POSIX" }, {}, {}).unicode).toBe(false);
  });
  it("未设 locale → 假定 UTF-8", () => {
    expect(resolveColor({}, {}, {}).unicode).toBe(true);
  });
  it("LC_CTYPE 压过 LANG", () => {
    expect(
      resolveColor({ LANG: "C", LC_CTYPE: "en_US.UTF-8" }, {}, {}).unicode,
    ).toBe(true);
  });
});

describe("Style: identity == 彩色去 ANSI (NFR-U-001)", () => {
  it("identityStyle 所有方法原样返回", () => {
    for (const m of ["bold", "dim", "costHigh", "error"] as const) {
      expect(identityStyle[m]("X")).toBe("X");
    }
    expect(identityStyle.colorEnabled).toBe(false);
  });

  it("ansiStyle 包裹 SGR 且 reset 成对; strip 后还原", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        for (const m of ["bold", "dim", "costHigh", "error"] as const) {
          const colored = ansiStyle[m](s);
          expect(colored.startsWith("\x1b[")).toBe(true);
          expect(colored.endsWith("\x1b[0m")).toBe(true);
          expect(strip(colored)).toBe(s); // 去 ANSI == identity
        }
      }),
    );
  });

  it("makeStyle 按 colorEnabled 选择", () => {
    expect(makeStyle({ colorEnabled: true })).toBe(ansiStyle);
    expect(makeStyle({ colorEnabled: false })).toBe(identityStyle);
  });

  it("具体 SGR 码符合 ADR-002/REQ-002 (luminance 轴, 非红绿)", () => {
    expect(ansiStyle.bold("x")).toBe("\x1b[1mx\x1b[0m");
    expect(ansiStyle.dim("x")).toBe("\x1b[2mx\x1b[0m");
    expect(ansiStyle.costHigh("x")).toBe("\x1b[1;33mx\x1b[0m"); // 粗琥珀
    expect(ansiStyle.error("x")).toBe("\x1b[1;31mx\x1b[0m"); // 粗红
  });
});
