import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readEvents, toNormalizedMessage } from "../src/reader.js";
import { sessionize } from "../src/sessionize.js";
import {
  byPeriod,
  byModel,
  commandRows,
  countCommands,
} from "../src/aggregate.js";
import { MESSAGE_SEND_EVENT } from "../src/types.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "sample.jsonl",
);

describe("e2e: 真实样本片段全流程 (回归锁定)", () => {
  it("跳过坏行, 聚合数字正确, cost=null 计 0 且标记", async () => {
    const { events, skipped } = await readEvents(FIXTURE);
    expect(skipped).toBe(1); // 一行损坏

    events.sort((a, b) => a.time - b.time);
    const messages = events
      .filter((e) => e.event === MESSAGE_SEND_EVENT)
      .map(toNormalizedMessage);

    expect(messages).toHaveLength(4);
    // 钱守恒: 0.01+0.02+0(null)+0.05
    const total = messages.reduce((s, m) => s + m.cost, 0);
    expect(total).toBeCloseTo(0.08, 6);
    expect(messages.filter((m) => m.costMissing)).toHaveLength(1);

    const days = byPeriod(messages, "day");
    expect(days.reduce((s, r) => s + r.cost, 0)).toBeCloseTo(0.08, 6);

    const models = byModel(messages);
    expect(models.find((r) => r.key === "gpt-4")!.count).toBe(2);
    expect(models.find((r) => r.key === "claude-3")!.count).toBe(2);

    // session: cli session x2 切两段, 中间 cost=null 那条因 time 间隔/归零另起
    const sessions = sessionize(events);
    expect(sessions.reduce((s, x) => s + x.cost, 0)).toBeCloseTo(0.08, 6);
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    const cmds = commandRows(countCommands(events));
    expect(cmds.find((c) => c.command === "command_run")!.count).toBe(2);
  });
});
