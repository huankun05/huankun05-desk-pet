import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  buildFileReviewPrompt,
  buildReviewSystemPrompt,
  formatFileChangeForPrompt,
  selectFilesToReview,
  parseFileReviewResponse,
  runLLMReview,
  generateSummary,
  saveLLMReview,
  loadLLMReview,
  hasLLMReview,
  listLLMReviews,
  getReviewStats,
  type LLMReviewResult,
  type FileReview,
} from "./llm-reviewer";
import type { ReviewSnapshot, ReviewFileChange } from "../../../shared/review-types";

// ── 测试辅助函数 ───────────────────────────────────────────

function createMockFileChange(overrides: Partial<ReviewFileChange> = {}): ReviewFileChange {
  return {
    kind: "modified",
    oldPath: "src/test.ts",
    newPath: "src/test.ts",
    additions: 10,
    deletions: 5,
    hunks: [
      {
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 10,
        lines: [
          { type: "context", oldLine: 1, newLine: 1, text: "const x = 1;" },
          { type: "add", oldLine: null, newLine: 2, text: "const y = 2;" },
          { type: "remove", oldLine: 2, newLine: null, text: "const old = 3;" },
          { type: "context", oldLine: 3, newLine: 3, text: "const z = 4;" },
        ],
      },
    ],
    ...overrides,
  };
}

function createMockSnapshot(overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
  return {
    runId: "test-run-123",
    startedAt: Date.now() - 60000,
    endedAt: Date.now(),
    status: "completed",
    files: [createMockFileChange()],
    ...overrides,
  };
}

// ── 测试 ───────────────────────────────────────────────────

describe("llm-reviewer", () => {
  describe("buildFileReviewPrompt", () => {
    it("包含文件路径和变更类型", () => {
      const fileChange = createMockFileChange({ newPath: "src/app.ts", kind: "created" });
      const prompt = buildFileReviewPrompt(fileChange);
      expect(prompt).toContain("src/app.ts");
      expect(prompt).toContain("created");
    });

    it("包含新增和删除行数", () => {
      const fileChange = createMockFileChange({ additions: 20, deletions: 8 });
      const prompt = buildFileReviewPrompt(fileChange);
      expect(prompt).toContain("20");
      expect(prompt).toContain("8");
    });

    it("包含 diff 内容", () => {
      const fileChange = createMockFileChange();
      const prompt = buildFileReviewPrompt(fileChange);
      expect(prompt).toContain("```diff");
      expect(prompt).toContain("const y = 2;");
    });

    it("要求返回 JSON 格式", () => {
      const fileChange = createMockFileChange();
      const prompt = buildFileReviewPrompt(fileChange);
      expect(prompt).toContain("qualityScore");
      expect(prompt).toContain("securityIssues");
      expect(prompt).toContain("improvements");
    });
  });

  describe("buildReviewSystemPrompt", () => {
    it("包含审查维度", () => {
      const prompt = buildReviewSystemPrompt();
      expect(prompt).toContain("代码质量");
      expect(prompt).toContain("安全性");
      expect(prompt).toContain("正确性");
      expect(prompt).toContain("完整性");
    });

    it("要求返回 JSON", () => {
      const prompt = buildReviewSystemPrompt();
      expect(prompt).toContain("JSON");
    });
  });

  describe("formatFileChangeForPrompt", () => {
    it("格式化 modified 文件的 diff", () => {
      const fileChange = createMockFileChange();
      const result = formatFileChangeForPrompt(fileChange);
      expect(result).toContain("@@");
      expect(result).toContain("+const y = 2;");
      expect(result).toContain("-const old = 3;");
      expect(result).toContain(" const x = 1;");
    });

    it("二进制文件返回提示", () => {
      const fileChange = createMockFileChange({ kind: "binary", hunks: undefined });
      const result = formatFileChangeForPrompt(fileChange);
      expect(result).toContain("二进制文件");
    });

    it("大文本文件返回提示", () => {
      const fileChange = createMockFileChange({ kind: "large-text", hunks: undefined });
      const result = formatFileChangeForPrompt(fileChange);
      expect(result).toContain("大文本文件");
    });

    it("重命名文件返回提示", () => {
      const fileChange = createMockFileChange({ kind: "renamed", hunks: undefined, additions: 0, deletions: 0 });
      const result = formatFileChangeForPrompt(fileChange);
      expect(result).toContain("文件重命名");
    });

    it("无 hunks 时返回提示", () => {
      const fileChange = createMockFileChange({ hunks: undefined });
      const result = formatFileChangeForPrompt(fileChange);
      expect(result).toContain("无 diff");
    });

    it("截断过长的 diff", () => {
      const longLines = Array.from({ length: 1000 }, (_, i) => ({
        type: "add" as const,
        oldLine: null,
        newLine: i + 1,
        text: `line ${i} `.repeat(10),
      }));
      const fileChange = createMockFileChange({
        hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1000, lines: longLines }],
      });
      const result = formatFileChangeForPrompt(fileChange);
      expect(result.length).toBeLessThanOrEqual(8000 + 50); // 截断 + 提示
      expect(result).toContain("已截断");
    });
  });

  describe("selectFilesToReview", () => {
    it("按变更大小排序", () => {
      const files = [
        createMockFileChange({ newPath: "small.ts", additions: 1, deletions: 0 }),
        createMockFileChange({ newPath: "large.ts", additions: 100, deletions: 50 }),
        createMockFileChange({ newPath: "medium.ts", additions: 20, deletions: 10 }),
      ];
      const selected = selectFilesToReview(files, 10);
      expect(selected[0].newPath).toBe("large.ts");
      expect(selected[1].newPath).toBe("medium.ts");
      expect(selected[2].newPath).toBe("small.ts");
    });

    it("限制最大文件数", () => {
      const files = Array.from({ length: 30 }, (_, i) =>
        createMockFileChange({ newPath: `file${i}.ts`, additions: i }),
      );
      const selected = selectFilesToReview(files, 5);
      expect(selected.length).toBe(5);
    });

    it("默认最大 20 个文件", () => {
      const files = Array.from({ length: 30 }, (_, i) =>
        createMockFileChange({ newPath: `file${i}.ts`, additions: i }),
      );
      const selected = selectFilesToReview(files);
      expect(selected.length).toBe(20);
    });
  });

  describe("parseFileReviewResponse", () => {
    it("解析有效的 JSON 响应", () => {
      const response = JSON.stringify({
        qualityScore: 4,
        qualityComment: "代码质量不错",
        securityIssues: ["存在 SQL 注入风险"],
        improvements: ["添加错误处理"],
        hasPotentialBug: false,
      });
      const fileChange = createMockFileChange();
      const result = parseFileReviewResponse(response, fileChange);
      expect(result.qualityScore).toBe(4);
      expect(result.qualityComment).toBe("代码质量不错");
      expect(result.securityIssues).toEqual(["存在 SQL 注入风险"]);
      expect(result.improvements).toEqual(["添加错误处理"]);
      expect(result.hasPotentialBug).toBe(false);
      expect(result.filePath).toBe("src/test.ts");
      expect(result.changeKind).toBe("modified");
    });

    it("解析被 markdown 包裹的 JSON", () => {
      const response = "```json\n" + JSON.stringify({ qualityScore: 3 }) + "\n```";
      const fileChange = createMockFileChange();
      const result = parseFileReviewResponse(response, fileChange);
      expect(result.qualityScore).toBe(3);
    });

    it("无效 JSON 返回默认值", () => {
      const response = "这不是 JSON";
      const fileChange = createMockFileChange();
      const result = parseFileReviewResponse(response, fileChange);
      expect(result.qualityScore).toBe(3); // 默认
      expect(result.qualityComment).toContain("无法解析");
      expect(result.securityIssues).toEqual([]);
      expect(result.improvements).toEqual([]);
    });

    it("限制评分在 1-5 之间", () => {
      const fileChange = createMockFileChange();
      expect(parseFileReviewResponse(JSON.stringify({ qualityScore: 10 }), fileChange).qualityScore).toBe(5);
      expect(parseFileReviewResponse(JSON.stringify({ qualityScore: 0 }), fileChange).qualityScore).toBe(1);
      expect(parseFileReviewResponse(JSON.stringify({ qualityScore: -5 }), fileChange).qualityScore).toBe(1);
    });

    it("非数字评分返回默认 3", () => {
      const fileChange = createMockFileChange();
      expect(parseFileReviewResponse(JSON.stringify({ qualityScore: "abc" }), fileChange).qualityScore).toBe(3);
    });
  });

  describe("runLLMReview", () => {
    it("没有文件变更时返回 skipped", async () => {
      const snapshot = createMockSnapshot({ files: [] });
      const mockLLMCall = vi.fn().mockResolvedValue("{}");
      const result = await runLLMReview(snapshot, mockLLMCall);
      expect(result.status).toBe("skipped");
      expect(result.fileReviews).toEqual([]);
      expect(mockLLMCall).not.toHaveBeenCalled();
    });

    it("调用 LLM 审查每个文件", async () => {
      const snapshot = createMockSnapshot({
        files: [
          createMockFileChange({ newPath: "file1.ts" }),
          createMockFileChange({ newPath: "file2.ts" }),
        ],
      });
      const mockLLMCall = vi.fn().mockResolvedValue(JSON.stringify({
        qualityScore: 4,
        qualityComment: "good",
        securityIssues: [],
        improvements: [],
        hasPotentialBug: false,
      }));
      const result = await runLLMReview(snapshot, mockLLMCall, "test-model");
      expect(mockLLMCall).toHaveBeenCalledTimes(2);
      expect(result.fileReviews.length).toBe(2);
      expect(result.status).toBe("completed");
      expect(result.model).toBe("test-model");
    });

    it("LLM 调用失败时记录错误但继续", async () => {
      const snapshot = createMockSnapshot({
        files: [
          createMockFileChange({ newPath: "good.ts" }),
          createMockFileChange({ newPath: "bad.ts" }),
        ],
      });
      const mockLLMCall = vi.fn()
        .mockResolvedValueOnce(JSON.stringify({ qualityScore: 4, qualityComment: "good", securityIssues: [], improvements: [], hasPotentialBug: false }))
        .mockRejectedValueOnce(new Error("LLM timeout"));
      const result = await runLLMReview(snapshot, mockLLMCall);
      expect(result.fileReviews.length).toBe(2);
      expect(result.fileReviews[1].qualityComment).toContain("审查失败");
      expect(result.fileReviews[1].qualityComment).toContain("LLM timeout");
    });

    it("计算平均质量评分", async () => {
      const snapshot = createMockSnapshot({
        files: [
          createMockFileChange({ newPath: "file1.ts" }),
          createMockFileChange({ newPath: "file2.ts" }),
        ],
      });
      const mockLLMCall = vi.fn()
        .mockResolvedValueOnce(JSON.stringify({ qualityScore: 5, qualityComment: "excellent", securityIssues: [], improvements: [], hasPotentialBug: false }))
        .mockResolvedValueOnce(JSON.stringify({ qualityScore: 3, qualityComment: "ok", securityIssues: [], improvements: [], hasPotentialBug: false }));
      const result = await runLLMReview(snapshot, mockLLMCall);
      expect(result.overallQualityScore).toBe(4);
    });

    it("汇总安全问题和改进建议", async () => {
      const snapshot = createMockSnapshot({
        files: [
          createMockFileChange({ newPath: "file1.ts" }),
          createMockFileChange({ newPath: "file2.ts" }),
        ],
      });
      const mockLLMCall = vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          qualityScore: 3, qualityComment: "ok",
          securityIssues: ["SQL 注入"],
          improvements: ["添加测试"],
          hasPotentialBug: false,
        }))
        .mockResolvedValueOnce(JSON.stringify({
          qualityScore: 3, qualityComment: "ok",
          securityIssues: ["XSS"],
          improvements: ["重构"],
          hasPotentialBug: true,
          bugDescription: "空指针",
        }));
      const result = await runLLMReview(snapshot, mockLLMCall);
      expect(result.securityConcerns.length).toBe(2);
      expect(result.securityConcerns[0]).toContain("file1.ts");
      expect(result.securityConcerns[0]).toContain("SQL 注入");
      expect(result.improvementSuggestions.length).toBe(2);
    });
  });

  describe("generateSummary", () => {
    it("优秀评分生成正面评价", () => {
      const reviews: FileReview[] = [
        { filePath: "a.ts", changeKind: "modified", qualityScore: 5, qualityComment: "", securityIssues: [], improvements: [], hasPotentialBug: false },
      ];
      const summary = generateSummary(reviews, 5, 1);
      expect(summary).toContain("优秀");
      expect(summary).toContain("未发现明显的 bug");
    });

    it("有 bug 时提示关注", () => {
      const reviews: FileReview[] = [
        { filePath: "a.ts", changeKind: "modified", qualityScore: 3, qualityComment: "", securityIssues: [], improvements: [], hasPotentialBug: true, bugDescription: "bug" },
      ];
      const summary = generateSummary(reviews, 3, 1);
      expect(summary).toContain("潜在 bug");
    });

    it("有安全问题时提示修复", () => {
      const reviews: FileReview[] = [
        { filePath: "a.ts", changeKind: "modified", qualityScore: 3, qualityComment: "", securityIssues: ["issue"], improvements: [], hasPotentialBug: false },
      ];
      const summary = generateSummary(reviews, 3, 1);
      expect(summary).toContain("安全问题");
    });

    it("包含文件数量信息", () => {
      const reviews: FileReview[] = [
        { filePath: "a.ts", changeKind: "modified", qualityScore: 4, qualityComment: "", securityIssues: [], improvements: [], hasPotentialBug: false },
        { filePath: "b.ts", changeKind: "modified", qualityScore: 0, qualityComment: "failed", securityIssues: [], improvements: [], hasPotentialBug: false },
      ];
      const summary = generateSummary(reviews, 4, 5);
      expect(summary).toContain("5 个文件");
      expect(summary).toContain("审查了 1 个文件");
    });
  });

  describe("持久化", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-llm-review-test-"));
    });

    afterEach(() => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it("保存和加载审查结果", () => {
      const result: LLMReviewResult = {
        runId: "test-run",
        reviewedAt: Date.now(),
        summary: "测试总结",
        overallQualityScore: 4.5,
        securityConcerns: ["安全问题1"],
        improvementSuggestions: ["建议1"],
        fileReviews: [],
        status: "completed",
        model: "test-model",
      };

      saveLLMReview(tempDir, result);
      const loaded = loadLLMReview(tempDir, "test-run");
      expect(loaded).not.toBeNull();
      expect(loaded?.runId).toBe("test-run");
      expect(loaded?.summary).toBe("测试总结");
      expect(loaded?.overallQualityScore).toBe(4.5);
      expect(loaded?.model).toBe("test-model");
    });

    it("hasLLMReview 正确检测", () => {
      expect(hasLLMReview(tempDir, "nonexistent")).toBe(false);

      const result: LLMReviewResult = {
        runId: "exists",
        reviewedAt: Date.now(),
        summary: "",
        overallQualityScore: 0,
        securityConcerns: [],
        improvementSuggestions: [],
        fileReviews: [],
        status: "completed",
      };
      saveLLMReview(tempDir, result);
      expect(hasLLMReview(tempDir, "exists")).toBe(true);
    });

    it("加载不存在的审查返回 null", () => {
      expect(loadLLMReview(tempDir, "nonexistent")).toBeNull();
    });

    it("损坏的 JSON 返回 null", () => {
      const reviewDir = path.join(tempDir, "cyrene-runs", "reviews", "corrupted");
      fs.mkdirSync(reviewDir, { recursive: true });
      fs.writeFileSync(path.join(reviewDir, "llm-review.json"), "not json", "utf8");
      expect(loadLLMReview(tempDir, "corrupted")).toBeNull();
    });

    it("listLLMReviews 按时间倒序列出所有审查", () => {
      // 空目录返回空数组
      expect(listLLMReviews(tempDir)).toEqual([]);

      // 保存 3 个审查结果（不同时间）
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const result: LLMReviewResult = {
          runId: `run-${i}`,
          reviewedAt: now - i * 1000, // run-0 最新，run-2 最早
          summary: `review ${i}`,
          overallQualityScore: 3 + i,
          securityConcerns: i === 0 ? ["issue"] : [],
          improvementSuggestions: [],
          fileReviews: [
            {
              filePath: `file-${i}.ts`,
              changeKind: "modified",
              qualityScore: 3 + i,
              qualityComment: "",
              securityIssues: [],
              improvements: [],
              hasPotentialBug: i === 1,
            },
          ],
          status: i === 2 ? "failed" : "completed",
        };
        saveLLMReview(tempDir, result);
      }

      const list = listLLMReviews(tempDir);
      expect(list).toHaveLength(3);
      // 按时间倒序：run-0 最新，应该在第一个
      expect(list[0].runId).toBe("run-0");
      expect(list[1].runId).toBe("run-1");
      expect(list[2].runId).toBe("run-2");

      // limit 参数生效
      const limited = listLLMReviews(tempDir, 2);
      expect(limited).toHaveLength(2);
      expect(limited[0].runId).toBe("run-0");
    });

    it("getReviewStats 正确计算统计汇总", () => {
      // 空目录返回零统计
      const emptyStats = getReviewStats(tempDir);
      expect(emptyStats.totalReviews).toBe(0);
      expect(emptyStats.completedReviews).toBe(0);
      expect(emptyStats.avgOverallQualityScore).toBeNull();

      // 保存审查结果
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const result: LLMReviewResult = {
          runId: `stats-run-${i}`,
          reviewedAt: now - i * 1000,
          summary: "",
          overallQualityScore: 3 + i, // 3, 4, 5
          securityConcerns: i === 0 ? ["security issue"] : [],
          improvementSuggestions: [],
          fileReviews: [
            {
              filePath: `file-${i}.ts`,
              changeKind: "modified",
              qualityScore: 3 + i,
              qualityComment: "",
              securityIssues: [],
              improvements: [],
              hasPotentialBug: i === 1,
            },
          ],
          status: i === 2 ? "failed" : "completed",
        };
        saveLLMReview(tempDir, result);
      }

      const stats = getReviewStats(tempDir);
      expect(stats.totalReviews).toBe(3);
      expect(stats.completedReviews).toBe(2); // run-0, run-1
      expect(stats.failedReviews).toBe(1); // run-2
      expect(stats.skippedReviews).toBe(0);
      // 平均质量分：(3 + 4) / 2 = 3.5（仅统计 completed）
      expect(stats.avgOverallQualityScore).toBe(3.5);
      expect(stats.reviewsWithSecurityConcerns).toBe(1); // run-0
      expect(stats.reviewsWithPotentialBugs).toBe(1); // run-1
      expect(stats.totalFilesReviewed).toBe(3);
      expect(stats.earliestReviewAt).toBe(now - 2000); // run-2 最早
      expect(stats.latestReviewAt).toBe(now); // run-0 最新
    });
  });
});
