import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";

export const AIDER_CONF_PATH = join(homedir(), ".aider.conf.yml");
export const DEFAULT_LOG_PATH = join(homedir(), ".aider", "analytics.jsonl");

/** 把开头的 ~ 展开为 home。 */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : p;
}

export type LogLocation =
  | { found: true; path: string }
  | {
      found: false;
      reason: "no-conf" | "no-key" | "file-missing";
      path?: string;
    };

/**
 * 发现 analytics.jsonl 路径。
 * 后置: found=true 时 path 指向一个真实存在的文件; 否则 reason 说明为何走引导。
 */
export function discoverLogPath(confPath = AIDER_CONF_PATH): LogLocation {
  // 显式覆盖 (测试 / 非标准部署): 优先于配置文件发现。
  const override = process.env.AIDER_USAGE_LOG;
  if (override && override.trim() !== "") {
    const p = expandHome(override.trim());
    return existsSync(p)
      ? { found: true, path: p }
      : { found: false, reason: "file-missing", path: p };
  }

  if (!existsSync(confPath)) return { found: false, reason: "no-conf" };

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(confPath, "utf8"));
  } catch {
    return { found: false, reason: "no-key" };
  }
  if (typeof raw !== "object" || raw === null) {
    return { found: false, reason: "no-key" };
  }
  const logField = (raw as Record<string, unknown>)["analytics-log"];
  if (typeof logField !== "string" || logField.trim() === "") {
    return { found: false, reason: "no-key" };
  }

  const path = expandHome(logField.trim());
  if (!existsSync(path)) return { found: false, reason: "file-missing", path };
  return { found: true, path };
}
