/**
 * 注入式着色 (REQ-004 / ADR-002)。
 *
 * 内联 ANSI, 不引入 picocolors —— resolveColor 已掌权"是否上色", 第三方探测冗余。
 * 关闭时所有方法为 identity (原样返回), 故"纯文本分支 == 彩色分支去 ANSI"。
 *
 * 色轴走 luminance/weight, 非红绿 (NFR-U-001): high=粗琥珀, low=暗, error 才用红。
 */

import type { Capability } from "./capability.js";

export interface Style {
  /** 是否真的发 ANSI; identityStyle 为 false。 */
  readonly colorEnabled: boolean;
  /** 加粗 (1) —— TOTAL 行。 */
  bold(s: string): string;
  /** 变暗 (2) —— low/零成本行、note。 */
  dim(s: string): string;
  /** 粗琥珀 (1;33) —— high 成本档。 */
  costHigh(s: string): string;
  /** 粗红 (1;31) —— error 严重级 (始终配 `error:` 文本前缀)。 */
  error(s: string): string;
}

const ESC = "\x1b[";
const RESET = "\x1b[0m";

function wrap(code: string, s: string): string {
  return `${ESC}${code}m${s}${RESET}`;
}

/** 着色关闭: 所有方法原样返回。 */
export const identityStyle: Style = {
  colorEnabled: false,
  bold: (s) => s,
  dim: (s) => s,
  costHigh: (s) => s,
  error: (s) => s,
};

/** 着色开启: 内联 SGR 转义, reset 成对。 */
export const ansiStyle: Style = {
  colorEnabled: true,
  bold: (s) => wrap("1", s),
  dim: (s) => wrap("2", s),
  costHigh: (s) => wrap("1;33", s),
  error: (s) => wrap("1;31", s),
};

/** 由 Capability.colorEnabled 选择 Style。 */
export function makeStyle(cap: Pick<Capability, "colorEnabled">): Style {
  return cap.colorEnabled ? ansiStyle : identityStyle;
}
