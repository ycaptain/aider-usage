import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sessionize, GAP_THRESHOLD_SECONDS } from "../src/sessionize.js";
import type { RawEvent } from "../src/types.js";

function msg(time: number, totalCost: number, cost = 0.01): RawEvent {
  return {
    event: "message_send",
    properties: { cost, total_cost: totalCost, main_model: "m" },
    user_id: "u",
    time,
  };
}
function cliSession(time: number): RawEvent {
  return { event: "cli session", properties: {}, user_id: "u", time };
}

describe("sessionize 状态边界", () => {
  it("空流 -> 空数组", () => {
    expect(sessionize([])).toEqual([]);
  });

  it("单条 message -> 一个 session", () => {
    const s = sessionize([msg(100, 0.01)]);
    expect(s).toHaveLength(1);
    expect(s[0]!.messages).toHaveLength(1);
  });

  it('"cli session" 事件强制开新 session', () => {
    const s = sessionize([msg(100, 0.05), cliSession(200), msg(300, 0.02)]);
    expect(s).toHaveLength(2);
  });

  it("cli session 优先: 即使 total_cost 不归零也切", () => {
    // total_cost 持续上升 (不归零), 但中间有 cli session 事件
    const s = sessionize([msg(100, 0.05), cliSession(150), msg(200, 0.9)]);
    expect(s).toHaveLength(2);
  });

  it("total_cost 回落 -> 切新 session (无 cli session 也切)", () => {
    const s = sessionize([msg(100, 0.5), msg(200, 0.02)]);
    expect(s).toHaveLength(2);
  });

  it("间隔恰好 30 分 (==阈值) -> 同一 session", () => {
    const s = sessionize([msg(0, 0.1), msg(GAP_THRESHOLD_SECONDS, 0.2)]);
    expect(s).toHaveLength(1);
  });

  it("间隔 > 30 分 (阈值+1) -> 切新 session", () => {
    const s = sessionize([msg(0, 0.1), msg(GAP_THRESHOLD_SECONDS + 1, 0.2)]);
    expect(s).toHaveLength(2);
  });

  it("空 session (cli session 后无 message) 不产出", () => {
    const s = sessionize([cliSession(100), cliSession(200), msg(300, 0.01)]);
    expect(s).toHaveLength(1);
  });
});

describe("sessionize 不变量 (PBT: fast-check 生成随机流证伪)", () => {
  // 生成器: 随机 message_send + cli session 事件, 按 time 升序排序 (满足前置条件)
  const eventArb = fc.oneof(
    fc.record({
      kind: fc.constant("msg" as const),
      time: fc.integer({ min: 0, max: 10_000_000 }),
      totalCost: fc.double({ min: 0, max: 1000, noNaN: true }),
      cost: fc.double({ min: 0, max: 10, noNaN: true }),
    }),
    fc.record({
      kind: fc.constant("cli" as const),
      time: fc.integer({ min: 0, max: 10_000_000 }),
    }),
  );

  const streamArb = fc
    .array(eventArb, { maxLength: 200 })
    .map((arr) =>
      [...arr]
        .sort((a, b) => a.time - b.time)
        .map((e) =>
          e.kind === "msg"
            ? msg(e.time, e.totalCost, e.cost)
            : cliSession(e.time),
        ),
    );

  it("钱守恒: Σsession.cost == Σmessage.cost", () => {
    fc.assert(
      fc.property(streamArb, (events) => {
        const totalMsgCost = events
          .filter((e) => e.event === "message_send")
          .reduce((s, e) => s + (e.properties.cost as number), 0);
        const sessions = sessionize(events);
        const totalSessionCost = sessions.reduce((s, x) => s + x.cost, 0);
        expect(totalSessionCost).toBeCloseTo(totalMsgCost, 6);
      }),
    );
  });

  it("划分: 所有 session 的 message 数之和 == message_send 总数 (不重不漏)", () => {
    fc.assert(
      fc.property(streamArb, (events) => {
        const msgCount = events.filter(
          (e) => e.event === "message_send",
        ).length;
        const sessions = sessionize(events);
        const sum = sessions.reduce((s, x) => s + x.messages.length, 0);
        expect(sum).toBe(msgCount);
      }),
    );
  });

  it("每个产出的 session 非空, 且内部 time 单调不减", () => {
    fc.assert(
      fc.property(streamArb, (events) => {
        for (const s of sessionize(events)) {
          expect(s.messages.length).toBeGreaterThan(0);
          for (let i = 1; i < s.messages.length; i++) {
            expect(s.messages[i]!.time).toBeGreaterThanOrEqual(
              s.messages[i - 1]!.time,
            );
          }
        }
      }),
    );
  });
});
