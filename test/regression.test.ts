import { describe, it, expect } from "vitest";
import { countCommands, commandRows } from "../src/aggregate.js";
import { filterByRange, localDayStart, localDayEnd } from "../src/filter.js";
import { sessionize } from "../src/sessionize.js";
import type { RawEvent } from "../src/types.js";

function cmd(name: string, time: number): RawEvent {
  return { event: name, properties: {}, user_id: "u", time };
}
function msg(time: number, totalCost: number): RawEvent {
  return {
    event: "message_send",
    properties: { cost: 0.01, total_cost: totalCost },
    user_id: "u",
    time,
  };
}

// 复现 [高] bug: commands 必须遵守 --since/--until
describe("regression: commands 遵守时间过滤", () => {
  it("窗口外的命令事件被过滤后不计入", () => {
    const events = [
      cmd("command_run", 100),
      cmd("command_run", 5000),
      cmd("command_ask", 9999),
    ];
    const since = 4000;
    const until = 6000;
    const filtered = filterByRange(events, since, until);
    const counts = countCommands(filtered);
    expect(counts.command_run).toBe(1); // 只有 time=5000 那条
    expect(counts.command_ask).toBeUndefined();
  });

  it("countCommands 用前缀匹配, 捕获 doc 未列的 command_tokens", () => {
    const counts = countCommands([
      cmd("command_tokens", 1),
      cmd("launched", 2),
      cmd("command_tokens", 3),
    ]);
    expect(counts.command_tokens).toBe(2);
    expect(counts.launched).toBeUndefined();
    expect(commandRows(counts)).toEqual([
      { command: "command_tokens", count: 2 },
    ]);
  });
});

// 复现 [中] bug: gui session 也应触发新 session
describe("regression: gui session 触发新 session", () => {
  it('"gui session" 事件与 "cli session" 一样切分', () => {
    const events = [msg(100, 0.05), cmd("gui session", 150), msg(200, 0.9)];
    // total_cost 持续上升不归零, 间隔 < 30 分; 唯一切分信号是 gui session
    expect(sessionize(events)).toHaveLength(2);
  });
});
