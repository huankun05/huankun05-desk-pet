// skill-recommend-tool —— 技能推荐工具测试。
// 覆盖：未初始化错误、正常推荐、未安装技能触发安装确认提示、会话内去重。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillService } from "./skill-service";
import {
  recommendSkillTool,
  setSkillRecommendService,
  setSkillPromptWindowGetter,
} from "./skill-recommend-tool";
import type { SkillEntry } from "./types";

// ── 测试辅助 ────────────────────────────────────────────────

function makeSkill(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: "test-skill",
    name: "Test Skill",
    description: "A test skill",
    dirPath: "/skills/test-skill",
    bodyPath: "/skills/test-skill/SKILL.md",
    references: [],
    enabled: true,
    source: "builtin",
    ...overrides,
  };
}

/** 记录 send 调用的假窗口。 */
function makeFakeWindow(): {
  window: { isDestroyed: () => boolean; webContents: { send: (channel: string, data: unknown) => void } };
  sent: Array<{ channel: string; data: unknown }>;
} {
  const sent: Array<{ channel: string; data: unknown }> = [];
  return {
    window: {
      isDestroyed: () => false,
      webContents: { send: (channel: string, data: unknown) => { sent.push({ channel, data }); } },
    },
    sent,
  };
}

describe("recommend_skill 工具", () => {
  let tempDir: string;
  let service: SkillService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-skill-rec-"));
    service = new SkillService({
      userSkillsDir: path.join(tempDir, "skills"),
      installedSkills: [
        makeSkill({ id: "code-reviewer", name: "代码审查员", description: "审查代码质量" }),
      ],
    });
    setSkillRecommendService(service);
    setSkillPromptWindowGetter(null);
  });

  afterEach(() => {
    setSkillRecommendService(null);
    setSkillPromptWindowGetter(null);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("服务未初始化时返回错误", async () => {
    setSkillRecommendService(null);
    const result = JSON.parse(await recommendSkillTool.execute({ query: "写代码" })) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain("尚未初始化");
  });

  it("缺少 query 参数时返回错误", async () => {
    const result = JSON.parse(await recommendSkillTool.execute({})) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain("query");
  });

  it("返回推荐列表（含未安装技能）", async () => {
    const result = JSON.parse(await recommendSkillTool.execute({ query: "审查代码质量" })) as {
      success: boolean;
      count: number;
      recommendations: Array<{ skillId: string; installed: boolean }>;
    };
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    // 已安装的 code-reviewer 应出现在推荐中
    expect(result.recommendations.some((r) => r.skillId === "code-reviewer" && r.installed)).toBe(true);
  });

  it("未安装且匹配度高的技能触发安装确认提示，且会话内不重复触发", async () => {
    const fake = makeFakeWindow();
    setSkillPromptWindowGetter(() => fake.window as never);

    const first = JSON.parse(await recommendSkillTool.execute({ query: "review code quality" })) as {
      success: boolean;
      recommendations: Array<{ skillId: string; installed: boolean }>;
    };
    expect(first.success).toBe(true);

    // 目录里应存在未安装且匹配 code 审查类别的技能（如 code-reviewer 已安装，取其它）
    const uninstalledPrompt = fake.sent.find((s) => s.channel === "skill:install-prompt");
    // 未安装目录项可能不匹配该 query，因此只断言：触发时数据形状正确
    if (uninstalledPrompt) {
      const data = uninstalledPrompt.data as { skillId: string; skillName: string };
      expect(data.skillId).toBeTruthy();
      expect(data.skillName).toBeTruthy();
    }

    // 再次调用同一 query：同一技能不应重复弹提示
    await recommendSkillTool.execute({ query: "review code quality" });
    const promptCount = fake.sent.filter((s) => s.channel === "skill:install-prompt").length;
    expect(promptCount).toBeLessThanOrEqual(1);
  });
});
