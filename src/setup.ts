import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AIDER_CONF_PATH, DEFAULT_LOG_PATH } from "./config.js";

export interface SetupResult {
  action: "created" | "added" | "already-present";
  confPath: string;
  logPath: string;
}

/**
 * 幂等写入 analytics-log 配置到 ~/.aider.conf.yml。
 * 后置: 配置文件存在且含 analytics-log 行; 已存在则不重复写 (already-present)。
 */
export function runSetup(
  confPath = AIDER_CONF_PATH,
  logPath = DEFAULT_LOG_PATH,
): SetupResult {
  const line = `analytics-log: ${logPath}`;

  if (!existsSync(confPath)) {
    writeFileSync(confPath, line + "\n", "utf8");
    return { action: "created", confPath, logPath };
  }

  const content = readFileSync(confPath, "utf8");
  if (/^\s*analytics-log\s*:/m.test(content)) {
    return { action: "already-present", confPath, logPath };
  }
  const sep = content.endsWith("\n") || content === "" ? "" : "\n";
  writeFileSync(confPath, content + sep + line + "\n", "utf8");
  return { action: "added", confPath, logPath };
}
