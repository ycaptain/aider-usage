import {
  type RawEvent,
  type Session,
  type NormalizedMessage,
  MESSAGE_SEND_EVENT,
  isSessionStartEvent,
} from "./types.js";
import { toNormalizedMessage } from "./reader.js";

/** 相邻 message 间隔超过此值 (秒) 视为 session 断开。==阈值算同 session, >阈值才切。 */
export const GAP_THRESHOLD_SECONDS = 30 * 60;

function finalize(messages: NormalizedMessage[]): Session {
  let cost = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  for (const m of messages) {
    cost += m.cost;
    promptTokens += m.promptTokens;
    completionTokens += m.completionTokens;
  }
  return {
    startTime: messages[0]!.time,
    endTime: messages[messages.length - 1]!.time,
    messages,
    cost,
    promptTokens,
    completionTokens,
  };
}

/**
 * 三信号推断 session 边界 (优先级: cli session > total_cost 回落 > 间隔>30分)。
 * 契约: 前置 = events 按 time 升序; 后置 = 每条 message_send 恰属一个非空 session;
 * 不变量: Σsession.cost == Σmessage.cost (钱守恒, 因每条 message 只进一个 current)。
 */
export function sessionize(events: RawEvent[]): Session[] {
  const sessions: Session[] = [];
  let current: NormalizedMessage[] = [];
  let forceNew = false; // "cli session" 事件: 下一条 message 起新 session

  const flush = () => {
    if (current.length > 0) sessions.push(finalize(current));
    current = [];
  };

  for (const ev of events) {
    // "cli session" / "gui session" 都是进程级起点 (与 reader 收集口径同一 helper)。
    if (isSessionStartEvent(ev.event)) {
      forceNew = true;
      continue;
    }
    if (ev.event !== MESSAGE_SEND_EVENT) continue;

    const m = toNormalizedMessage(ev);
    const last = current[current.length - 1];

    const isNew =
      forceNew ||
      last === undefined ||
      m.totalCost < last.totalCost || // total_cost 回落 = 新进程
      m.time - last.time > GAP_THRESHOLD_SECONDS;

    if (isNew) flush();
    current.push(m);
    forceNew = false;
  }
  flush();

  return sessions;
}
