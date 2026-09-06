// Global type augmentations for renderer

import type { ReviewSnapshot } from "../shared/review-types";
import type { AppUpdateApi } from "../shared/app-update";
import type { PluginManagementApi } from "../shared/plugin-management";

interface SystemApi {
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

// 与 preload 暴露的 reviewApi 对齐（LLM 审查结果 / 列表 / 统计）。
interface LLMFileReview {
  filePath: string;
  changeKind: string;
  qualityScore: number;
  qualityComment: string;
  securityIssues: string[];
  improvements: string[];
  hasPotentialBug: boolean;
  bugDescription?: string;
}

interface LLMReviewResult {
  runId: string;
  reviewedAt: number;
  summary: string;
  overallQualityScore: number;
  securityConcerns: string[];
  improvementSuggestions: string[];
  fileReviews: LLMFileReview[];
  status: "completed" | "failed" | "skipped";
  error?: string;
  model?: string;
}

interface ReviewStats {
  totalReviews: number;
  completedReviews: number;
  failedReviews: number;
  skippedReviews: number;
  avgOverallQualityScore: number | null;
  reviewsWithSecurityConcerns: number;
  reviewsWithPotentialBugs: number;
  totalFilesReviewed: number;
  earliestReviewAt: number | null;
  latestReviewAt: number | null;
}

interface ReviewApi {
  get: (runId: string) => Promise<ReviewSnapshot | null>;
  getLLM: (runId: string) => Promise<LLMReviewResult | null>;
  listLLM: (limit?: number) => Promise<LLMReviewResult[]>;
  llmStats: () => Promise<ReviewStats>;
}

declare global {
  interface Window {
    system?: SystemApi;
    review?: ReviewApi;
    appUpdate?: AppUpdateApi;
    plugins?: PluginManagementApi;
  }
}

// 注意：静态资源（*.png / *.svg / *.md?raw 等）的 declare module 通配声明
// 不在此文件声明——本文件因类型导入而成为"模块"，模块内的通配声明不参与模块解析。
// 这些声明已移至脚本式的 assets.d.ts。

export {};
