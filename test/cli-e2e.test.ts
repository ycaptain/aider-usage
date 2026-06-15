import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "src", "cli.ts");
const TSX = join(here, "..", "node_modules", ".bin", "tsx");
const FIXTURE = join(here, "fixtures", "sample.jsonl");

const ANSI = /\x1b\[/;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): Run {
  const r = spawnSync(TSX, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, AIDER_USAGE_LOG: FIXTURE, ...env },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

const COMMANDS = [
  "summary",
  "daily",
  "weekly",
  "monthly",
  "models",
  "session",
  "commands",
];

describe("cli e2e: 流纪律 (REQ-003)", () => {
  it("note (malformed/missing-cost) 只去 stderr, 不污染 stdout", () => {
    const r = run(["daily", "--json"]);
    expect(r.stdout).not.toContain("note:");
    expect(r.stdout).not.toContain("malformed");
    expect(r.stderr).toContain("note:");
  });

  it("缺失成本脚注不再混入 stdout (修复 render.ts 泄漏 bug)", () => {
    const r = run(["daily"]); // 非 TTY → table 无色
    expect(r.stdout).not.toContain("no cost data");
    expect(r.stderr).toContain("no cost data");
  });
});

describe("cli e2e: 退出码 (REQ-003)", () => {
  it("无日志 → exit 1", () => {
    const r = run(["daily"], { AIDER_USAGE_LOG: "/nonexistent/none.jsonl" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^error: /m);
  });
  it("空范围 → exit 0, json 输出 []", () => {
    const r = run(["daily", "--since", "2030-01-01", "--json"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("[]");
  });
  it("非法 --format → exit 1", () => {
    const r = run(["daily", "--format", "xml"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown format "xml"');
  });
  it("非法 --sort → exit 1 + 有效列表", () => {
    const r = run(["models", "--sort", "bogus"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown sort column");
    expect(r.stderr).toContain("cost");
  });
  it("--top 非十进制整数 (1e1/0x5/小数/空格) → exit 1", () => {
    for (const bad of ["1e1", "0x5", "3.5", " 3 ", "-1", "abc"]) {
      const r = run(["models", "--top", bad]);
      expect(r.status, `--top ${JSON.stringify(bad)}`).toBe(1);
      expect(r.stderr).toContain("invalid --top");
    }
  });
  it("summary + --sort/--reverse → exit 1 (不适用)", () => {
    expect(run(["summary", "--sort", "cost"]).status).toBe(1);
    expect(run(["summary", "--reverse"]).status).toBe(1);
    expect(run(["summary", "--sort", "cost"]).stderr).toContain(
      "do not apply to summary",
    );
  });
  it("非法日期 → exit 1", () => {
    const r = run(["daily", "--since", "2026-13-99"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("invalid --since");
  });
  it("since>until → exit 1", () => {
    const r = run(["daily", "--since", "2026-06-10", "--until", "2026-06-01"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is after");
  });
});

describe("cli e2e: 裸命令默认 = summary (ADR-005)", () => {
  it("裸命令输出窗口头 (= summary)", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Window:");
    expect(r.stdout).toContain("Top days by cost");
  });
});

// 横切不变量: 机读格式在所有命令上都必须零 ANSI 且 stdout 无 note (NFR-R-001 + REQ-003)
describe("cli e2e: 机读格式零 ANSI + stdout 纯净 (铺满所有命令)", () => {
  for (const cmd of COMMANDS) {
    for (const fmt of ["json", "md"]) {
      it(`${cmd} --format ${fmt}: stdout 无 ANSI, 无 note`, () => {
        const r = run([cmd, "--format", fmt, "--color", "always"]);
        expect(ANSI.test(r.stdout)).toBe(false); // 即便 --color always
        expect(r.stdout).not.toContain("note:");
      });
    }
  }
});

describe("cli e2e: --top 保留全量 TOTAL (REQ-007)", () => {
  it("md --top 1: body 截断但 TOTAL 覆盖全量", () => {
    const r = run(["models", "--sort", "cost", "--top", "1", "--format", "md"]);
    expect(r.stdout).toContain("| TOTAL | $0.0800 |"); // 全量合计
    expect(r.stderr).toContain("showing top 1 of 2 rows");
    // body 只有 claude-3 (最贵), 不含 gpt-4
    const bodyLines = r.stdout
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.includes("---"));
    expect(bodyLines.some((l) => l.includes("claude-3"))).toBe(true);
    expect(bodyLines.some((l) => l.includes("gpt-4"))).toBe(false);
  });
});

describe("cli e2e: csv (EPIC-003)", () => {
  it("models --format csv: RFC-4180, 小写表头, 无 TOTAL", () => {
    const r = run(["models", "--format", "csv"]);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\r\n");
    expect(lines[0]).toBe("model,cost,prompt,completion,msgs");
    expect(r.stdout).not.toContain("TOTAL");
  });
  it("summary --format csv → exit 1 (不适用)", () => {
    const r = run(["summary", "--format", "csv"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("csv is not supported for summary");
  });
});
