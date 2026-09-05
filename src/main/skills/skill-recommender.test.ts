import { describe, it, expect } from "vitest";
import { recommendSkills, recommendTopSkill } from "./skill-recommender";
import type { SkillEntry } from "./types";

// ── 测试辅助函数 ────────────────────────────────────────────

function makeSkill(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: "test-skill",
    name: "Test Skill",
    description: "A test skill for testing purposes",
    dirPath: "/skills/test-skill",
    bodyPath: "/skills/test-skill/SKILL.md",
    references: [],
    enabled: true,
    source: "builtin",
    ...overrides,
  };
}

// ── 测试用例 ────────────────────────────────────────────────

describe("skill-recommender", () => {
  describe("recommendSkills", () => {
    it("returns empty array for empty input", () => {
      const skills = [makeSkill()];
      expect(recommendSkills("", skills)).toEqual([]);
    });

    it("returns empty array for empty skills list", () => {
      expect(recommendSkills("hello", [])).toEqual([]);
    });

    it("recommends skills based on description keywords", () => {
      const skills = [
        makeSkill({
          id: "music-player",
          name: "Music Player",
          description: "Play music and manage playlists",
        }),
        makeSkill({
          id: "code-executor",
          name: "Code Executor",
          description: "Execute Python and JavaScript code",
        }),
      ];

      const results = recommendSkills("play some music", skills);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.id).toBe("music-player");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("recommends skills based on id keywords", () => {
      const skills = [
        makeSkill({ id: "weather-check", name: "Weather", description: "Check weather" }),
        makeSkill({ id: "news-reader", name: "News", description: "Read news" }),
      ];

      const results = recommendSkills("weather", skills);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.id).toBe("weather-check");
    });

    it("recommends skills based on name keywords", () => {
      const skills = [
        makeSkill({ id: "s1", name: "Calendar Manager", description: "Manage events" }),
        makeSkill({ id: "s2", name: "Email Client", description: "Send emails" }),
      ];

      const results = recommendSkills("calendar", skills);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.name).toBe("Calendar Manager");
    });

    it("recommends skills based on associated tools", () => {
      const skills = [
        makeSkill({
          id: "s1",
          name: "Skill 1",
          description: "First skill",
          tools: ["music_play", "music_search"],
        }),
        makeSkill({
          id: "s2",
          name: "Skill 2",
          description: "Second skill",
          tools: ["code_execute", "file_read"],
        }),
      ];

      const results = recommendSkills("music", skills);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.id).toBe("s1");
    });

    it("respects limit option", () => {
      const skills = [
        makeSkill({ id: "s1", name: "Music", description: "Play music" }),
        makeSkill({ id: "s2", name: "Music2", description: "Play music too" }),
        makeSkill({ id: "s3", name: "Music3", description: "Play music also" }),
      ];

      const results = recommendSkills("music", skills, { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("respects minScore option", () => {
      const skills = [
        makeSkill({ id: "s1", name: "Music", description: "Play music" }),
      ];

      // "xyz" 不应该匹配任何技能
      const results = recommendSkills("xyz", skills, { minScore: 50 });
      expect(results.length).toBe(0);
    });

    it("filters by mode", () => {
      const skills = [
        makeSkill({ id: "s1", name: "Work Skill", description: "Work", modes: ["work"] }),
        makeSkill({ id: "s2", name: "Code Skill", description: "Code", modes: ["code"] }),
      ];

      const results = recommendSkills("work", skills, { mode: "code" });
      expect(results.every((r) => r.skill.modes?.includes("code"))).toBe(true);
    });

    it("filters only enabled skills by default", () => {
      const skills = [
        makeSkill({ id: "s1", name: "Enabled", description: "Enabled skill", enabled: true }),
        makeSkill({ id: "s2", name: "Disabled", description: "Disabled skill", enabled: false }),
      ];

      const results = recommendSkills("skill", skills);
      expect(results.every((r) => r.skill.enabled)).toBe(true);
    });

    it("includes disabled skills when onlyEnabled=false", () => {
      const skills = [
        makeSkill({ id: "s1", name: "Enabled", description: "Enabled skill", enabled: true }),
        makeSkill({ id: "s2", name: "Disabled", description: "Disabled skill", enabled: false }),
      ];

      const results = recommendSkills("skill", skills, { onlyEnabled: false });
      expect(results.length).toBe(2);
    });

    it("returns matched keywords in result", () => {
      const skills = [
        makeSkill({ id: "music", name: "Music", description: "Play music and songs" }),
      ];

      const results = recommendSkills("play music", skills);
      expect(results[0].matchedKeywords.length).toBeGreaterThan(0);
      expect(results[0].matchedKeywords).toContain("music");
    });

    it("returns reason in result", () => {
      const skills = [
        makeSkill({ id: "music", name: "Music", description: "Play music" }),
      ];

      const results = recommendSkills("play music", skills);
      expect(results[0].reason).toBeTruthy();
      expect(results[0].reason).toContain("匹配关键词");
    });

    it("sorts results by score descending", () => {
      const skills = [
        makeSkill({ id: "s1", name: "Music Player", description: "Play music and manage playlists" }),
        makeSkill({ id: "s2", name: "Code", description: "Execute code" }),
      ];

      const results = recommendSkills("play music playlist", skills);
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("handles Chinese input", () => {
      const skills = [
        makeSkill({ id: "music", name: "音乐播放器", description: "播放音乐和管理播放列表" }),
        makeSkill({ id: "code", name: "代码执行", description: "执行 Python 和 JavaScript 代码" }),
      ];

      const results = recommendSkills("播放音乐", skills);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.id).toBe("music");
    });

    it("handles mixed Chinese-English input", () => {
      const skills = [
        makeSkill({ id: "music", name: "Music", description: "Play music 播放音乐" }),
      ];

      const results = recommendSkills("play 音乐", skills);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("recommendTopSkill", () => {
    it("returns the top recommendation", () => {
      const skills = [
        makeSkill({ id: "music", name: "Music", description: "Play music" }),
        makeSkill({ id: "code", name: "Code", description: "Execute code" }),
      ];

      const result = recommendTopSkill("play music", skills);
      expect(result).not.toBeNull();
      expect(result?.skill.id).toBe("music");
    });

    it("returns null when no match", () => {
      const skills = [
        makeSkill({ id: "music", name: "Music", description: "Play music" }),
      ];

      const result = recommendTopSkill("xyz unrelated", skills, { minScore: 80 });
      expect(result).toBeNull();
    });

    it("returns null for empty input", () => {
      const skills = [makeSkill()];
      expect(recommendTopSkill("", skills)).toBeNull();
    });
  });
});
