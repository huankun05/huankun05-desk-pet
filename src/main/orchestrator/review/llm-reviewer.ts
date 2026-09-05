// LLM Reviewer — 后台 LLM 审查模块
//
// 设计原则：
// - 核心逻辑（prompt 构建、结果解析、存储）是纯函数，易于测试
// - LLM 调用接口抽象为函数类型（LLMCallFn），不依赖具体 model client
// - 审查结果持久化到 review 目录下的 llm-review.json
// - 后续集成到 Run 结束流程时，只需要传入一个 LLM 调用函数
//
// 移植参考：Hermes agent/background_review.py 的设计思路
// - Run 结束后后台启动 LLM 审查
// - 审查文件变更的质量、安全性、是否遗漏
// - 审查结果持久化

import * as fs from "fs";
import * as path from "path";
import { logger, LogTag } from "../../logger";
import type { ReviewSnapshot, ReviewFileChange } from "../../../shared/review-types";

// ── 类型定义 ───────────────────────────────────────────────

/** 单个文件的审查结果 */
export interface FileReview {
  /** 文件路径（展示路径） */
  filePath: string;
  /** 变更类型：created / modified / deleted / renamed / binary / large-text */
  changeKind: string;
  /** 代码质量评分（1-5） */
  qualityScore: number;
  /** 质量评价 */
  qualityComment: string;
  /** 安全问题列表 */
  securityIssues: string[];
  /** 改进建议列表 */
  improvements: string[];
  /** 是否有潜在 bug */
  hasPotentialBug: boolean;
  /** bug 描述 */
  bugDescription?: string;
}

/** LLM 审查结果 */
export interface LLMReviewResult {
  /** 关联的 Run ID */
  runId: string;
  /** 审查时间戳 */
  reviewedAt: number;
  /** 总体评价 */
  summary: string;
  /** 总体质量评分（1-5，所有文件的平均分） */
  overallQualityScore: number;
  /** 安全问题汇总 */
  securityConcerns: string[];
  /** 改进建议汇总 */
  improvementSuggestions: string[];
  /** 每个文件的审查结果 */
  fileReviews: FileReview[];
  /** 审查状态 */
  status: "completed" | "failed" | "skipped";
  /** 失败原因（status=failed 时） */
  error?: string;
  /** 使用的模型 */
  model?: string;
}

/** LLM 调用函数接口（抽象，不依赖具体 model client） */
export type LLMCallFn = (prompt: string, systemPrompt?: string) => Promise<string>;

// ── 常量 ───────────────────────────────────────────────────

/** 单个文件 diff 的最大字符数（超过则截断，避免 prompt 过长） */
const MAX_DIFF_CHARS_PER_FILE = 8000;

/** 审查的最大文件数（超过则只审查前 N 个最大的变更） */
const MAX_FILES_TO_REVIEW = 20;

// ── Prompt 构建 ────────────────────────────────────────────

/**
 * 构建单个文件的审查 prompt。
 * 纯函数，易于测试。
 */
export function buildFileReviewPrompt(fileChange: ReviewFileChange): string {
  const diffText = formatFileChangeForPrompt(fileChange);
  return `请审查以下文件变更的代码质量、安全性和潜在问题。

文件路径：${fileChange.newPath || fileChange.oldPath}
变更类型：${fileChange.kind}
新增行数：${fileChange.additions}
删除行数：${fileChange.deletions}

变更内容（diff）：
\`\`\`diff
${diffText}
\`\`\`

请以 JSON 格式返回审查结果，格式如下：
{
  "qualityScore": 1-5的整数（5=优秀，1=很差）,
  "qualityComment": "简短的质量评价",
  "securityIssues": ["安全问题1", "安全问题2"],
  "improvements": ["改进建议1", "改进建议2"],
  "hasPotentialBug": true/false,
  "bugDescription": "如果有潜在bug，描述它"
}

只返回 JSON，不要返回其他内容。`;
}

/**
 * 构建总体审查的 system prompt。
 */
export function buildReviewSystemPrompt(): string {
  return `你是一个资深代码审查专家。你的任务是审查 AI Agent 生成的代码变更。

审查维度：
1. 代码质量：可读性、可维护性、命名规范、代码结构
2. 安全性：是否有安全漏洞、敏感信息泄露、注入风险
3. 正确性：是否有逻辑错误、边界条件处理、潜在 bug
4. 完整性：是否遗漏了必要的处理、错误处理、测试

要求：
- 客观、严格，不要因为是 AI 生成的就放宽标准
- 给出具体的、可操作的改进建议
- 安全问题要明确指出风险等级
- 如果代码质量很好，也要明确肯定

返回格式必须是严格的 JSON，不要包含 markdown 代码块标记。`;
}

/**
 * 格式化文件变更为 prompt 用的文本。
 * 纯函数，易于测试。
 */
export function formatFileChangeForPrompt(fileChange: ReviewFileChange): string {
  if (!fileChange.hunks || fileChange.hunks.length === 0) {
    if (fileChange.kind === "binary") {
      return `[二进制文件，不显示 diff]`;
    }
    if (fileChange.kind === "large-text") {
      return `[大文本文件，不显示 diff]`;
    }
    if (fileChange.kind === "renamed") {
      return `[文件重命名，内容未变]`;
    }
    return `[无 diff 内容]`;
  }

  const lines: string[] = [];
  for (const hunk of fileChange.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.type === "add") {
        lines.push(`+${line.text}`);
      } else if (line.type === "remove") {
        lines.push(`-${line.text}`);
      } else {
        lines.push(` ${line.text}`);
      }
    }
  }

  const result = lines.join("\n");
  // 截断过长的 diff
  if (result.length > MAX_DIFF_CHARS_PER_FILE) {
    return result.slice(0, MAX_DIFF_CHARS_PER_FILE) + "\n... [diff 已截断，过长]";
  }
  return result;
}

/**
 * 选择需要审查的文件（按变更大小排序，取前 N 个）。
 * 纯函数，易于测试。
 */
export function selectFilesToReview(files: ReviewFileChange[], maxFiles: number = MAX_FILES_TO_REVIEW): ReviewFileChange[] {
  // 按 additions + deletions 排序，大的优先
  const sorted = [...files].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
  return sorted.slice(0, maxFiles);
}

// ── 结果解析 ───────────────────────────────────────────────

/**
 * 解析 LLM 返回的单个文件审查结果。
 * 纯函数，易于测试。
 */
export function parseFileReviewResponse(response: string, fileChange: ReviewFileChange): FileReview {
  // 尝试提取 JSON（可能被 markdown 代码块包裹）
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : response;

  let parsed: Partial<FileReview> = {};
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // 解析失败时返回默认值
    logger.warn(LogTag.Runtime, `[LLMReviewer] parse file review failed, using defaults`);
  }

  return {
    filePath: fileChange.newPath || fileChange.oldPath,
    changeKind: fileChange.kind,
    qualityScore: clampScore(parsed.qualityScore),
    qualityComment: parsed.qualityComment || "（无法解析评价）",
    securityIssues: Array.isArray(parsed.securityIssues) ? parsed.securityIssues : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    hasPotentialBug: Boolean(parsed.hasPotentialBug),
    bugDescription: parsed.bugDescription,
  };
}

/** 限制评分在 1-5 之间 */
function clampScore(score: unknown): number {
  const n = typeof score === "number" ? score : parseInt(String(score), 10);
  if (isNaN(n)) return 3;
  return Math.max(1, Math.min(5, n));
}

// ── 审查执行 ───────────────────────────────────────────────

/**
 * 执行 LLM 审查。
 *
 * @param snapshot ReviewSnapshot（来自 run-review-tracker）
 * @param llmCall LLM 调用函数
 * @param model 使用的模型名称（可选，用于记录）
 * @returns LLMReviewResult
 */
export async function runLLMReview(
  snapshot: ReviewSnapshot,
  llmCall: LLMCallFn,
  model?: string,
): Promise<LLMReviewResult> {
  const runId = snapshot.runId;
  const startTime = Date.now();

  logger.info(LogTag.Runtime, `[LLMReviewer] starting review for runId=${runId}, files=${snapshot.files.length}`);

  // 没有文件变更时跳过
  if (snapshot.files.length === 0) {
    return {
      runId,
      reviewedAt: Date.now(),
      summary: "本次 Run 没有文件变更，无需审查。",
      overallQualityScore: 0,
      securityConcerns: [],
      improvementSuggestions: [],
      fileReviews: [],
      status: "skipped",
      model,
    };
  }

  // 选择需要审查的文件
  const filesToReview = selectFilesToReview(snapshot.files);
  const fileReviews: FileReview[] = [];
  const systemPrompt = buildReviewSystemPrompt();

  // 逐个文件审查
  for (const fileChange of filesToReview) {
    try {
      const prompt = buildFileReviewPrompt(fileChange);
      const response = await llmCall(prompt, systemPrompt);
      const review = parseFileReviewResponse(response, fileChange);
      fileReviews.push(review);
      logger.info(LogTag.Runtime, `[LLMReviewer] reviewed ${review.filePath}: score=${review.qualityScore} bugs=${review.hasPotentialBug}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(LogTag.Runtime, `[LLMReviewer] review failed for ${fileChange.newPath || fileChange.oldPath}: ${msg}`);
      fileReviews.push({
        filePath: fileChange.newPath || fileChange.oldPath,
        changeKind: fileChange.kind,
        qualityScore: 0,
        qualityComment: `审查失败：${msg}`,
        securityIssues: [],
        improvements: [],
        hasPotentialBug: false,
      });
    }
  }

  // 汇总
  const validReviews = fileReviews.filter((r) => r.qualityScore > 0);
  const overallQualityScore = validReviews.length > 0
    ? Math.round(validReviews.reduce((sum, r) => sum + r.qualityScore, 0) / validReviews.length * 10) / 10
    : 0;

  const securityConcerns = fileReviews
    .flatMap((r) => r.securityIssues.map((issue) => `[${r.filePath}] ${issue}`));

  const improvementSuggestions = fileReviews
    .flatMap((r) => r.improvements.map((imp) => `[${r.filePath}] ${imp}`));

  // 生成总体评价
  const summary = generateSummary(fileReviews, overallQualityScore, snapshot.files.length);

  const duration = Date.now() - startTime;
  logger.info(LogTag.Runtime, `[LLMReviewer] review completed for runId=${runId}, duration=${duration}ms, files=${fileReviews.length}, avgScore=${overallQualityScore}`);

  return {
    runId,
    reviewedAt: Date.now(),
    summary,
    overallQualityScore,
    securityConcerns,
    improvementSuggestions,
    fileReviews,
    status: "completed",
    model,
  };
}

/**
 * 生成总体评价。
 * 纯函数，易于测试。
 */
export function generateSummary(fileReviews: FileReview[], avgScore: number, totalFiles: number): string {
  const reviewedCount = fileReviews.filter((r) => r.qualityScore > 0).length;
  const bugCount = fileReviews.filter((r) => r.hasPotentialBug).length;
  const securityCount = fileReviews.filter((r) => r.securityIssues.length > 0).length;

  let qualityText: string;
  if (avgScore >= 4.5) qualityText = "优秀";
  else if (avgScore >= 3.5) qualityText = "良好";
  else if (avgScore >= 2.5) qualityText = "一般";
  else if (avgScore >= 1.5) qualityText = "较差";
  else qualityText = "未评分";

  const parts: string[] = [];
  parts.push(`本次 Run 共变更 ${totalFiles} 个文件，审查了 ${reviewedCount} 个文件。`);
  parts.push(`总体代码质量：${qualityText}（平均 ${avgScore}/5）。`);

  if (bugCount > 0) {
    parts.push(`发现 ${bugCount} 个文件存在潜在 bug，建议重点关注。`);
  }
  if (securityCount > 0) {
    parts.push(`发现 ${securityCount} 个文件存在安全问题，建议立即修复。`);
  }
  if (bugCount === 0 && securityCount === 0 && avgScore >= 3.5) {
    parts.push(`未发现明显的 bug 或安全问题，代码质量较好。`);
  }

  return parts.join(" ");
}

// ── 持久化 ─────────────────────────────────────────────────

/**
 * 保存 LLM 审查结果到磁盘。
 * 存储位置：<userData>/cyrene-runs/reviews/<runId>/llm-review.json
 */
export function saveLLMReview(userDataRoot: string, result: LLMReviewResult): void {
  const reviewDir = path.join(userDataRoot, "cyrene-runs", "reviews", result.runId);
  const reviewPath = path.join(reviewDir, "llm-review.json");

  try {
    fs.mkdirSync(reviewDir, { recursive: true });
    // 原子写：.tmp + rename
    const tmpPath = `${reviewPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2), "utf8");
    fs.renameSync(tmpPath, reviewPath);
    logger.info(LogTag.Runtime, `[LLMReviewer] saved review to ${reviewPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(LogTag.Runtime, `[LLMReviewer] save review failed: ${msg}`);
  }
}

/**
 * 读取已保存的 LLM 审查结果。
 */
export function loadLLMReview(userDataRoot: string, runId: string): LLMReviewResult | null {
  const reviewPath = path.join(userDataRoot, "cyrene-runs", "reviews", runId, "llm-review.json");
  if (!fs.existsSync(reviewPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reviewPath, "utf8")) as LLMReviewResult;
  } catch {
    return null;
  }
}

/**
 * 检查是否已有 LLM 审查结果。
 */
export function hasLLMReview(userDataRoot: string, runId: string): boolean {
  return loadLLMReview(userDataRoot, runId) !== null;
}

// ── 列表与统计 ──────────────────────────────────────────────

/** 审查统计汇总 */
export interface ReviewStats {
  /** 总审查数 */
  totalReviews: number;
  /** 成功审查数（status=completed） */
  completedReviews: number;
  /** 失败审查数（status=failed） */
  failedReviews: number;
  /** 跳过审查数（status=skipped） */
  skippedReviews: number;
  /** 平均总体质量分（1-5，仅统计 completed） */
  avgOverallQualityScore: number | null;
  /** 有安全问题的审查数 */
  reviewsWithSecurityConcerns: number;
  /** 有潜在 bug 的审查数 */
  reviewsWithPotentialBugs: number;
  /** 总审查文件数 */
  totalFilesReviewed: number;
  /** 最早审查时间 */
  earliestReviewAt: number | null;
  /** 最近审查时间 */
  latestReviewAt: number | null;
}

/**
 * 列出所有已保存的 LLM 审查结果。
 * 按审查时间倒序排列。
 * @param userDataRoot 用户数据根目录
 * @param limit 最大返回数量（默认 50）
 */
export function listLLMReviews(userDataRoot: string, limit: number = 50): LLMReviewResult[] {
  const reviewsDir = path.join(userDataRoot, "cyrene-runs", "reviews");
  if (!fs.existsSync(reviewsDir)) return [];

  const results: LLMReviewResult[] = [];
  try {
    const runDirs = fs.readdirSync(reviewsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const runId of runDirs) {
      const review = loadLLMReview(userDataRoot, runId);
      if (review) {
        results.push(review);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(LogTag.Runtime, `[LLMReviewer] list reviews failed: ${msg}`);
    return [];
  }

  // 按审查时间倒序
  results.sort((a, b) => b.reviewedAt - a.reviewedAt);
  return results.slice(0, limit);
}

/**
 * 获取 LLM 审查统计汇总。
 * 遍历所有已保存的审查结果，计算统计指标。
 */
export function getReviewStats(userDataRoot: string): ReviewStats {
  const allReviews = listLLMReviews(userDataRoot, 10000); // 足够大的 limit 以获取全部

  const stats: ReviewStats = {
    totalReviews: allReviews.length,
    completedReviews: 0,
    failedReviews: 0,
    skippedReviews: 0,
    avgOverallQualityScore: null,
    reviewsWithSecurityConcerns: 0,
    reviewsWithPotentialBugs: 0,
    totalFilesReviewed: 0,
    earliestReviewAt: null,
    latestReviewAt: null,
  };

  if (allReviews.length === 0) return stats;

  let totalQualityScore = 0;
  let completedCount = 0;

  for (const review of allReviews) {
    // 状态统计
    if (review.status === "completed") {
      stats.completedReviews++;
      totalQualityScore += review.overallQualityScore;
      completedCount++;
    } else if (review.status === "failed") {
      stats.failedReviews++;
    } else if (review.status === "skipped") {
      stats.skippedReviews++;
    }

    // 安全问题统计
    if (review.securityConcerns && review.securityConcerns.length > 0) {
      stats.reviewsWithSecurityConcerns++;
    }

    // 潜在 bug 统计
    if (review.fileReviews && review.fileReviews.some((f) => f.hasPotentialBug)) {
      stats.reviewsWithPotentialBugs++;
    }

    // 文件数统计
    if (review.fileReviews) {
      stats.totalFilesReviewed += review.fileReviews.length;
    }

    // 时间统计
    if (stats.earliestReviewAt === null || review.reviewedAt < stats.earliestReviewAt) {
      stats.earliestReviewAt = review.reviewedAt;
    }
    if (stats.latestReviewAt === null || review.reviewedAt > stats.latestReviewAt) {
      stats.latestReviewAt = review.reviewedAt;
    }
  }

  // 平均质量分
  if (completedCount > 0) {
    stats.avgOverallQualityScore = Math.round((totalQualityScore / completedCount) * 100) / 100;
  }

  return stats;
}
