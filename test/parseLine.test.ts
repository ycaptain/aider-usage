import { describe, it, expect } from "vitest";
import { parseLine, toNormalizedMessage } from "../src/reader.js";

describe("parseLine (不变量: 永不抛异常, 脏数据返回 null)", () => {
  it("解析合法 message_send 行", () => {
    const line = JSON.stringify({
      event: "message_send",
      properties: { main_model: "gpt-4", cost: 0.01 },
      user_id: "u1",
      time: 1755100406,
    });
    const ev = parseLine(line);
    expect(ev).not.toBeNull();
    expect(ev!.event).toBe("message_send");
    expect(ev!.time).toBe(1755100406);
  });

  it('解析带空格的 "cli session" 事件名 (真实命名, 非 cli_session)', () => {
    const line = JSON.stringify({
      event: "cli session",
      properties: { main_model: "gpt-4" },
      user_id: "u1",
      time: 1755100327,
    });
    expect(parseLine(line)!.event).toBe("cli session");
  });

  it("向前兼容: 含未来新增字段 (cache tokens) 仍正常解析", () => {
    const line = JSON.stringify({
      event: "message_send",
      properties: { cost: 0.01, cache_read_tokens: 999 },
      user_id: "u1",
      time: 100,
    });
    const ev = parseLine(line);
    expect(ev).not.toBeNull();
    expect(ev!.properties.cache_read_tokens).toBe(999);
  });

  it("properties 缺失时归一为空对象", () => {
    const line = JSON.stringify({
      event: "launched",
      user_id: "u1",
      time: 100,
    });
    expect(parseLine(line)!.properties).toEqual({});
  });

  // 脏数据边界 (BVA): 全部返回 null, 绝不抛
  it.each([
    ["坏 JSON", "{not json"],
    ["缺 event 键", JSON.stringify({ time: 1, user_id: "u" })],
    ["event 非字符串", JSON.stringify({ event: 123, time: 1, user_id: "u" })],
    ["time 非数值", JSON.stringify({ event: "x", time: "nope", user_id: "u" })],
    ["time 缺失", JSON.stringify({ event: "x", user_id: "u" })],
    [
      "time 为 NaN/Infinity",
      JSON.stringify({ event: "x", time: null, user_id: "u" }),
    ],
    ["空字符串", ""],
    ["纯空白", "   "],
    ["JSON 是数组而非对象", "[1,2,3]"],
  ])("脏数据返回 null: %s", (_label, line) => {
    expect(() => parseLine(line)).not.toThrow();
    expect(parseLine(line)).toBeNull();
  });
});

describe("toNormalizedMessage (cost 缺失判定只此一处)", () => {
  const base = {
    event: "message_send",
    user_id: "u1",
    time: 100,
  };

  it("完整字段正确归一", () => {
    const m = toNormalizedMessage({
      ...base,
      properties: {
        main_model: "gpt-4",
        edit_format: "diff",
        prompt_tokens: 1000,
        completion_tokens: 50,
        cost: 0.02,
        total_cost: 0.05,
      },
    });
    expect(m).toMatchObject({
      mainModel: "gpt-4",
      editFormat: "diff",
      promptTokens: 1000,
      completionTokens: 50,
      cost: 0.02,
      costMissing: false,
      totalCost: 0.05,
    });
  });

  it("cost=null -> cost=0 且 costMissing=true", () => {
    const m = toNormalizedMessage({ ...base, properties: { cost: null } });
    expect(m.cost).toBe(0);
    expect(m.costMissing).toBe(true);
  });

  it("cost 缺失 -> cost=0 且 costMissing=true", () => {
    const m = toNormalizedMessage({ ...base, properties: {} });
    expect(m.costMissing).toBe(true);
  });

  it("cost 为字符串 (非数值) -> costMissing=true", () => {
    const m = toNormalizedMessage({ ...base, properties: { cost: "0.5" } });
    expect(m.costMissing).toBe(true);
  });

  it("真实的 cost=0 -> costMissing=false (零成本是合法值)", () => {
    const m = toNormalizedMessage({ ...base, properties: { cost: 0 } });
    expect(m.cost).toBe(0);
    expect(m.costMissing).toBe(false);
  });

  it("缺 token 字段默认 0, 缺 model 默认 unknown", () => {
    const m = toNormalizedMessage({ ...base, properties: { cost: 0.01 } });
    expect(m.promptTokens).toBe(0);
    expect(m.completionTokens).toBe(0);
    expect(m.mainModel).toBe("unknown");
  });
});
