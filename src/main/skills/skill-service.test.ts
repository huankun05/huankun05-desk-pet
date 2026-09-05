import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillService } from "./skill-service";
import { SKILL_CATALOG } from "./skill-catalog-store";
import type { SkillEntry } from "./types";

// ── 测试辅助函数 ─────────────────────────────────────────────

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

// ── 测试用例 ─────────────────────────────────────────────────

describe("skill-service", () => {
  let tempDir: string;
  let service: SkillService;

  beforeEach(() => {
    // 创建临时目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-skill-test-"));
    service = new SkillService({
      userSkillsDir: path.join(tempDir, "skills"),
      installedSkills: [
        makeSkill({ id: "code-reviewer", name: "代码审查员", description: "审查代码质量" }),
      ],
    });
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("listSkills", () => {
    it("returns installed enabled skills", () => {
      const skills = service.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("code-reviewer");
    });

    it("filters by mode", () => {
      const skills = service.listSkills("work");
      expect(skills).toHaveLength(1);
    });

    it("excludes disabled skills", () => {
      const disabledService = new SkillService({
        userSkillsDir: path.join(tempDir, "skills"),
        installedSkills: [makeSkill({ id: "disabled", enabled: false })],
      });
      expect(disabledService.listSkills()).toHaveLength(0);
    });
  });

  describe("recommendSkills", () => {
    it("recommends installed skills matching user input", () => {
      const results = service.recommendSkills("审查代码质量和bug");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skillId).toBe("code-reviewer");
      expect(results[0].installed).toBe(true);
    });

    it("recommends not installed skills from catalog", () => {
      const results = service.recommendSkills("规划旅行行程和攻略");
      const travelSkill = results.find((r) => r.skillId === "travel-planner");
      expect(travelSkill).toBeDefined();
      expect(travelSkill?.installed).toBe(false);
    });

    it("respects limit option", () => {
      const results = service.recommendSkills("代码", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("can exclude not installed skills", () => {
      const results = service.recommendSkills("规划旅行", { includeNotInstalled: false });
      expect(results.every((r) => r.installed)).toBe(true);
    });

    it("returns empty array for empty input", () => {
      const results = service.recommendSkills("");
      expect(results).toEqual([]);
    });

    it("sorts results by score descending", () => {
      const results = service.recommendSkills("代码审查和旅行规划");
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe("getSkillCatalog", () => {
    it("returns all catalog items", () => {
      const catalog = service.getSkillCatalog();
      expect(catalog.length).toBe(SKILL_CATALOG.length);
    });

    it("filters by category", () => {
      const devSkills = service.getSkillCatalog("development");
      expect(devSkills.length).toBeGreaterThan(0);
      expect(devSkills.every((s) => s.category === "development")).toBe(true);
    });
  });

  describe("searchCatalog", () => {
    it("searches by name", () => {
      const results = service.searchCatalog("翻译");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("translator");
    });

    it("searches by description", () => {
      const results = service.searchCatalog("SQL 查询");
      expect(results.length).toBeGreaterThan(0);
    });

    it("searches by tags", () => {
      const results = service.searchCatalog("git");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty for no match", () => {
      const results = service.searchCatalog("nonexistent-skill-xyz");
      expect(results).toEqual([]);
    });
  });

  describe("installSkill", () => {
    it("installs a skill from catalog", async () => {
      const result = await service.installSkill("git-assistant");
      expect(result.success).toBe(true);
      expect(result.skillId).toBe("git-assistant");
      expect(result.skillPath).toBeDefined();

      // 验证 SKILL.md 文件已创建
      const skillMdPath = path.join(result.skillPath!, "SKILL.md");
      expect(fs.existsSync(skillMdPath)).toBe(true);
      const content = fs.readFileSync(skillMdPath, "utf-8");
      expect(content).toContain("Git 助手");
    });

    it("fails for already installed skill", async () => {
      // code-reviewer 已在 installedSkills 中
      const result = await service.installSkill("code-reviewer");
      expect(result.success).toBe(false);
      expect(result.error).toBe("ALREADY_INSTALLED");
    });

    it("fails for skill not in catalog", async () => {
      const result = await service.installSkill("nonexistent-skill-xyz");
      expect(result.success).toBe(false);
      expect(result.error).toBe("SKILL_NOT_FOUND");
    });

    it("creates references directory", async () => {
      const result = await service.installSkill("sql-assistant");
      expect(result.success).toBe(true);
      const referencesDir = path.join(result.skillPath!, "references");
      expect(fs.existsSync(referencesDir)).toBe(true);
    });
  });

  describe("uninstallSkill", () => {
    it("uninstalls an installed skill", async () => {
      // 先安装
      const installResult = await service.installSkill("git-assistant");
      expect(installResult.success).toBe(true);

      // 再卸载
      const uninstallResult = await service.uninstallSkill("git-assistant");
      expect(uninstallResult.success).toBe(true);

      // 验证目录已删除
      expect(fs.existsSync(installResult.skillPath!)).toBe(false);
    });

    it("fails for not installed skill", async () => {
      const result = await service.uninstallSkill("nonexistent-skill-xyz");
      expect(result.success).toBe(false);
      expect(result.error).toBe("NOT_INSTALLED");
    });
  });

  describe("isInstalled / isAvailable", () => {
    it("isInstalled returns true for installed skill", () => {
      expect(service.isInstalled("code-reviewer")).toBe(true);
    });

    it("isInstalled returns false for not installed skill", () => {
      expect(service.isInstalled("git-assistant")).toBe(false);
    });

    it("isAvailable returns true for catalog skill", () => {
      expect(service.isAvailable("git-assistant")).toBe(true);
    });

    it("isAvailable returns false for nonexistent skill", () => {
      expect(service.isAvailable("nonexistent-skill-xyz")).toBe(false);
    });
  });
});
