import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 在模块加载前创建临时 userData 目录（mock 工厂内 require 保证先于 ESM import 绑定）
vi.mock("electron", () => {
  const fsm = require("node:fs");
  const pathm = require("node:path");
  const osm = require("node:os");
  const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "cred-audit-test-"));
  return { app: { getPath: () => dir } };
});

import { logCredentialChange, listCredentialAudit, getCredentialAuditPath } from "./credential-audit";

describe("credential-audit", () => {
  beforeEach(() => {
    // 清空日志文件
    try {
      fs.rmSync(getCredentialAuditPath(), { force: true });
    } catch {
      // ignore
    }
  });

  it("写入后按时间倒序读取", () => {
    logCredentialChange({ action: "mcp.add", target: "mcp:github", detail: "GitHub" });
    logCredentialChange({ action: "model-settings.save", target: "model:DeepSeek（深度求索）", detail: "API Key 已更新" });
    const entries = listCredentialAudit();
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe("model-settings.save");
    expect(entries[0].target).toContain("DeepSeek");
    expect(entries[1].action).toBe("mcp.add");
    expect(entries[0].time).toBeGreaterThanOrEqual(entries[1].time);
  });

  it("limit 生效", () => {
    for (let i = 0; i < 10; i++) {
      logCredentialChange({ action: "credential.export", target: "credential:export", detail: `第 ${i} 条` });
    }
    expect(listCredentialAudit(3)).toHaveLength(3);
    expect(listCredentialAudit(0)).toHaveLength(1);
  });

  it("无日志时返回空数组", () => {
    expect(listCredentialAudit()).toEqual([]);
  });

  it("损坏行被跳过", () => {
    const filePath = getCredentialAuditPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{invalid json}\n" + JSON.stringify({ time: Date.now(), action: "mcp.remove", target: "mcp:x" }) + "\n", "utf-8");
    const entries = listCredentialAudit();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("mcp.remove");
  });

  it("文件中不含凭据明文", () => {
    logCredentialChange({ action: "credential.import", target: "credential:import", detail: "模型 1 条" });
    const raw = fs.readFileSync(getCredentialAuditPath(), "utf-8");
    expect(raw).not.toContain("sk-secret");
    expect(raw).not.toContain("enc:v1:");
  });
});
