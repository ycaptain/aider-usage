/**
 * 呈现能力解析 (REQ-001 / ADR-001)。
 *
 * 单一权威: 管线入口调一次 resolveColor, 把 Capability 注入渲染层。
 * 渲染层 MUST NOT 自行读 process.env 或探测 isTTY (前置条件归此处一方)。
 *
 * 三个相互独立的输出信号:
 *  - colorEnabled: 是否发 ANSI 着色。
 *  - markers:      是否在 Cost 单元格放成本档位标记 (▲ = ·)。
 *  - unicode:      标记用 Unicode 还是 ASCII 降级集 (^ = .)。
 */

export type ColorWhen = "auto" | "always" | "never";

/** 输出格式; 机读格式 (json/md/csv) 强制零着色零标记 (NFR-R-001)。 */
export type Format = "table" | "json" | "md" | "csv";

export interface Capability {
  /** 是否在 stdout/stderr 发 ANSI 着色。 */
  colorEnabled: boolean;
  /** 是否在 table 的 Cost 单元格放档位标记 (仅 TTY 上的 table)。 */
  markers: boolean;
  /** 标记字符集: true=Unicode(▲=·), false=ASCII(^=.)。 */
  unicode: boolean;
}

export interface ColorOpts {
  /** --color <when>; 缺省视为 auto。 */
  color?: ColorWhen;
  /** --no-color; 等价于 color=never。 */
  noColor?: boolean;
  /** 当前输出格式; 缺省 table。 */
  format?: Format;
}

/** 仅取 isTTY 的最小流契约 (便于测试注入)。 */
export interface StreamLike {
  isTTY?: boolean;
}

/** locale 判定是否支持 Unicode 标记。未设 locale → 视为现代 UTF-8 终端。 */
function detectUnicode(env: NodeJS.ProcessEnv): boolean {
  const locale = (env.LC_ALL || env.LC_CTYPE || env.LANG || "").toUpperCase();
  if (locale === "") return true; // 未设 → 假定 UTF-8
  if (locale === "C" || locale === "POSIX") return false;
  return locale.includes("UTF");
}

/**
 * 解析呈现能力。
 *
 * colorEnabled 优先级 (REQ-001): 机读格式 > 显式 flag > NO_COLOR > TERM=dumb > isTTY。
 *  - 机读格式 (json/md/csv): 永远 false, 无视 --color (NFR-R-001)。
 *  - --no-color / --color never: false。
 *  - --color always: true, 即便管道。
 *  - --color auto (或缺省): NO_COLOR(任意值) → false; TERM=dumb → false; 否则取 isTTY。
 *
 * markers: 仅 table 格式且 stdout 为 TTY 时为 true。
 *  - 管道/机读 → false (纯数据); 无色 TTY → true (标记是唯一档位信号, REQ-002)。
 *
 * @returns Capability, 三信号彼此独立。
 */
export function resolveColor(
  env: NodeJS.ProcessEnv,
  opts: ColorOpts,
  stream: StreamLike,
): Capability {
  const format = opts.format ?? "table";
  const machine = format !== "table";
  const unicode = detectUnicode(env);
  const isTTY = Boolean(stream.isTTY);

  const colorEnabled = resolveColorEnabled(env, opts, machine, isTTY);
  // 标记出现在"人看的、带装饰的表格": TTY, 或被 --color always 强制上色的管道。
  // 机读格式永不带标记。后者保证: 既然用户强制了颜色(装饰), mid 档也有标记可辨,
  // 不会出现"有色但 mid 无任何区分信号"的盲区。
  const markers = !machine && (isTTY || colorEnabled);

  return { colorEnabled, markers, unicode };
}

function resolveColorEnabled(
  env: NodeJS.ProcessEnv,
  opts: ColorOpts,
  machine: boolean,
  isTTY: boolean,
): boolean {
  if (machine) return false; // 机读格式硬零着色, 压过一切
  if (opts.noColor) return false; // 显式 flag
  if (opts.color === "always") return true; // 显式 flag, 压过 NO_COLOR/TTY
  if (opts.color === "never") return false; // 显式 flag
  // auto / 缺省 → 环境探测
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  return isTTY;
}
