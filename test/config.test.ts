import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { discoverLogPath } from "../src/config.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "sample.jsonl",
);

afterEach(() => {
  delete process.env.AIDER_USAGE_LOG;
});

describe("discoverLogPath", () => {
  it("AIDER_USAGE_LOG 覆盖且文件存在 -> found", () => {
    process.env.AIDER_USAGE_LOG = FIXTURE;
    expect(discoverLogPath()).toEqual({ found: true, path: FIXTURE });
  });

  it("覆盖路径不存在 -> file-missing", () => {
    process.env.AIDER_USAGE_LOG = "/nope/x.jsonl";
    const r = discoverLogPath();
    expect(r.found).toBe(false);
    if (!r.found) expect(r.reason).toBe("file-missing");
  });

  it("conf 文件不存在 -> no-conf", () => {
    const r = discoverLogPath("/nonexistent/.aider.conf.yml");
    expect(r).toEqual({ found: false, reason: "no-conf" });
  });
});
