/**
 * 类型层 = 最便宜的契约 (spec-first: 让非法状态不可表示优先于运行时检查)。
 *
 * 真实事件命名不一致 (已由源码核实): session 类用空格 "cli session"/"gui session",
 * command 类用下划线 "command_run"。照搬真实数据,不要想当然统一。
 */

/** analytics.jsonl 的原始单行结构。time 是整数 unix 秒。 */
export interface RawEvent {
  event: string;
  properties: Record<string, unknown>;
  /** 机器级持久 UUID, 不是 session 键。 */
  user_id: string;
  /** 整数 unix 秒。 */
  time: number;
}

/**
 * 归一后的 message_send。cost 缺失/null/非数值时 cost=0 且 costMissing=true;
 * 真实的 cost===0 是合法零成本, costMissing=false。判定只在 reader 做一次 (非冗余原则)。
 */
export interface NormalizedMessage {
  time: number;
  mainModel: string;
  editFormat: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  costMissing: boolean;
  /** 进程内累计成本; 回落到约等于 cost = 新进程信号。 */
  totalCost: number;
}

/** sessionize 推断出的一个 session。 */
export interface Session {
  startTime: number;
  endTime: number;
  messages: NormalizedMessage[];
  cost: number;
  promptTokens: number;
  completionTokens: number;
}

export const MESSAGE_SEND_EVENT = "message_send";

/**
 * session 起点判定 (进程级)。reader 收集与 sessionize 切分共用此单一口径, 避免两处漂移。
 * 显式枚举而非 endsWith("session"): 后者会误判 end_session/obsession 等; 真实日志
 * (源码核实) 只有 "cli session" / "gui session" 两种, 各带空格。
 */
export function isSessionStartEvent(name: string): boolean {
  return name === "cli session" || name === "gui session";
}

/**
 * command_* 事件判定。用前缀匹配而非硬编码白名单: 真实日志含 doc 未列的命令
 * (如 command_tokens), 白名单会漏掉它们。
 */
export function isCommandEvent(name: string): boolean {
  return name.startsWith("command_");
}
