// ReviewPanel — 气泡内的 Review 卡片。
//
// 默认折叠：圆角矩形头部（图标 + "N 个文件已更改" + 增删统计 + chevron）。
// 点击头部展开文件列表（kind 徽标 + 路径 + 增删统计），再点收起。
// 点击某个文件 → 调用 onOpenInspector(runId, fileIndex) 打开右侧纯 diff 面板。
//
// LLM 审查卡片：文件变更快照下方展示后台 LLM 审查结果（质量评分 / 安全问题 /
// 改进建议 / 文件级审查）。审查在 Run 结束后后台异步执行，打开时可能尚未完成，
// 因此轮询等待一段时间；仍未完成则停留在"审查中…"。

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../../i18n";
import type { ReviewFileChange, ReviewSnapshot } from "../../../../../shared/review-types";
import reminderIconUrl from "../../../assets/status-moods/提醒.png?url";
import "./ReviewPanel.css";

// LLMReviewResult / LLMFileReview 结构见 renderer/global.d.ts（与 preload reviewApi 对齐）。

/** 审查在 Run 结束后的后台异步执行；最多轮询这么久以等待结果落盘。 */
const LLM_REVIEW_MAX_RETRIES = 12;
const LLM_REVIEW_RETRY_DELAY = 2000;

function scoreClass(score: number): string {
  if (score >= 4.5) return "is-excellent";
  if (score >= 3.5) return "is-good";
  if (score >= 2.5) return "is-fair";
  return "is-poor";
}

/** 后台 LLM 审查结果卡片（无结果时展示"审查中…"，轮询超时后提供手动刷新）。 */
function LLMReviewCard({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const [review, setReview] = useState<LLMReviewResult | null>(null);
  const [filesExpanded, setFilesExpanded] = useState(false);
  /** 轮询是否已超时（仍无结果 → 显示刷新按钮）。 */
  const [exhausted, setExhausted] = useState(false);
  /** 手动刷新计数：变化时重启轮询。 */
  const [attempt, setAttempt] = useState(0);

  const fetchData = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.review?.getLLM(runId);
      if (result) {
        setReview(result);
        return true;
      }
    } catch {
      // 忽略，进入重试
    }
    return false;
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    setExhausted(false);

    const tick = async () => {
      if (cancelled) return;
      const ok = await fetchData();
      if (cancelled || ok) return;
      retryCount++;
      if (retryCount < LLM_REVIEW_MAX_RETRIES) {
        setTimeout(() => void tick(), LLM_REVIEW_RETRY_DELAY);
      } else {
        setExhausted(true);
      }
    };

    void tick();
    return () => { cancelled = true; };
  }, [runId, attempt, fetchData]);

  const handleRefresh = () => setAttempt((a) => a + 1);

  if (!review) {
    return (
      <section className="cy-llm-review is-pending" aria-label={t("review.llmAria")}>
        <span className="cy-llm-review__title">{t("review.llmTitle")}</span>
        <span className="cy-llm-review__pending">{t("review.llmPending")}</span>
        {exhausted && (
          <button type="button" className="cy-llm-review__refresh" onClick={handleRefresh}>
            {t("review.llmRefresh")}
          </button>
        )}
      </section>
    );
  }

  if (review.status === "skipped") {
    return (
      <section className="cy-llm-review is-skipped" aria-label={t("review.llmAria")}>
        <span className="cy-llm-review__title">{t("review.llmTitle")}</span>
        <span className="cy-llm-review__note">{t("review.llmSkipped")}</span>
      </section>
    );
  }

  if (review.status === "failed") {
    return (
      <section className="cy-llm-review is-failed" aria-label={t("review.llmAria")}>
        <span className="cy-llm-review__title">{t("review.llmTitle")}</span>
        <span className="cy-llm-review__note">{t("review.llmFailed", { error: review.error ?? "unknown" })}</span>
      </section>
    );
  }

  const score = review.overallQualityScore;
  const securityConcerns = review.securityConcerns ?? [];
  const improvements = review.improvementSuggestions ?? [];
  const hasBugs = review.fileReviews.some((f) => f.hasPotentialBug);

  return (
    <section className="cy-llm-review" aria-label={t("review.llmAria")}>
      <header className="cy-llm-review__header">
        <span className="cy-llm-review__header-titles">
          <span className="cy-llm-review__title">{t("review.llmTitle")}</span>
          {hasBugs && (
            <span className="cy-llm-review__badge" role="status">{t("review.llmBugBadge")}</span>
          )}
        </span>
        <span className={`cy-llm-review__score ${scoreClass(score)}`}>
          {score > 0 ? `${score}/5` : "—"}
        </span>
      </header>
      {review.summary && <p className="cy-llm-review__summary">{review.summary}</p>}
      {review.model && <p className="cy-llm-review__model">{t("review.llmModel", { model: review.model })}</p>}
      <div className="cy-llm-review__section">
        <h4 className="cy-llm-review__section-title">{t("review.llmSecurity")}</h4>
        {securityConcerns.length > 0 ? (
          <ul className="cy-llm-review__list">
            {securityConcerns.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : (
          <p className="cy-llm-review__empty">{t("review.llmNoSecurity")}</p>
        )}
      </div>
      <div className="cy-llm-review__section">
        <h4 className="cy-llm-review__section-title">{t("review.llmImprovements")}</h4>
        {improvements.length > 0 ? (
          <ul className="cy-llm-review__list">
            {improvements.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : (
          <p className="cy-llm-review__empty">{t("review.llmNoImprovements")}</p>
        )}
      </div>
      {review.fileReviews.length > 0 && (
        <div className="cy-llm-review__files">
          <button
            type="button"
            className="cy-llm-review__files-toggle"
            onClick={() => setFilesExpanded((v) => !v)}
            aria-expanded={filesExpanded}
          >
            <span>{t("review.llmFiles")}（{review.fileReviews.length}）</span>
            <svg className="cy-llm-review__chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
            </svg>
          </button>
          {filesExpanded && (
            <ul className="cy-llm-review__file-list">
              {review.fileReviews.map((file, i) => (
                <li key={i} className="cy-llm-review__file-item">
                  <div className="cy-llm-review__file-head">
                    <span className="cy-llm-review__file-path">{file.filePath}</span>
                    <span className={`cy-llm-review__file-score ${scoreClass(file.qualityScore)}`}>
                      {file.qualityScore > 0 ? `${file.qualityScore}/5` : "—"}
                    </span>
                  </div>
                  {file.qualityComment && <p className="cy-llm-review__file-comment">{file.qualityComment}</p>}
                  {file.hasPotentialBug && file.bugDescription && (
                    <p className="cy-llm-review__file-bugs">
                      {t("review.llmBugs")}：{file.bugDescription}
                    </p>
                  )}
                  {file.securityIssues.length > 0 && (
                    <ul className="cy-llm-review__file-security">
                      {file.securityIssues.map((issue, j) => <li key={j}>{issue}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// 只存 i18n key（t() 不能出现在模块顶层常量里），展示文案在组件内求值。
const KIND_LABEL_KEYS: Record<ReviewFileChange["kind"], string> = {
  modified: "review.kindModified",
  created: "review.kindCreated",
  deleted: "review.kindDeleted",
  renamed: "review.kindRenamed",
  binary: "review.kindBinary",
  "large-text": "review.kindLargeText",
};

const KIND_CLASS: Record<ReviewFileChange["kind"], string> = {
  modified: "is-modified",
  created: "is-created",
  deleted: "is-deleted",
  renamed: "is-renamed",
  binary: "is-binary",
  "large-text": "is-large",
};

function splitPath(filePath: string): { dir: string; base: string } {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (lastSlash < 0) return { dir: "", base: filePath };
  return { dir: filePath.slice(0, lastSlash + 1), base: filePath.slice(lastSlash + 1) };
}

export function ReviewPanel({
  runId,
  onOpenInspector,
}: {
  runId: string;
  onOpenInspector?: (runId: string, fileIndex: number) => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 500;

    const fetchData = async () => {
      if (cancelled) return;
      try {
        const result = await window.review?.get(runId);
        if (cancelled) return;
        if (result && result.files.length > 0) {
          setSnapshot(result);
          return;
        }
      } catch {
        // 忽略，进入重试
      }
      retryCount++;
      if (retryCount < MAX_RETRIES && !cancelled) {
        setTimeout(() => void fetchData(), RETRY_DELAY);
      }
    };

    void fetchData();
    return () => { cancelled = true; };
  }, [runId]);

  const totalAdd = useMemo(
    () => snapshot?.files.reduce((sum, f) => sum + f.additions, 0) ?? 0,
    [snapshot],
  );
  const totalDel = useMemo(
    () => snapshot?.files.reduce((sum, f) => sum + f.deletions, 0) ?? 0,
    [snapshot],
  );

  if (!snapshot) return null;

  return (
    <section className={`cy-review-panel${expanded ? " is-expanded" : ""}`} aria-label={t("review.panelAria")}>
      <button
        type="button"
        className="cy-review-panel__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <img className="cy-review-panel__icon" src={reminderIconUrl} alt="" aria-hidden="true" />
        <span className="cy-review-panel__title">
          {t("review.fileCount", { count: snapshot.files.length })}
        </span>
        <span className="cy-review-panel__stats">
          {totalAdd > 0 && <span className="is-add">+{totalAdd}</span>}
          {totalDel > 0 && <span className="is-remove">−{totalDel}</span>}
        </span>
        <svg className="cy-review-panel__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
        </svg>
      </button>
      {expanded && (
        <>
          <div className="cy-review-panel__list">
            {snapshot.files.map((file, index) => {
              const { dir, base } = splitPath(file.newPath);
              return (
                <button
                  key={`${file.kind}:${file.oldPath}:${file.newPath}:${index}`}
                  type="button"
                  className="cy-review-panel__file-item"
                  onClick={() => onOpenInspector?.(runId, index)}
                  title={file.newPath}
                >
                  <span className={`cy-review-panel__kind ${KIND_CLASS[file.kind]}`}>
                    {t(KIND_LABEL_KEYS[file.kind])}
                  </span>
                  <span className="cy-review-panel__file-path">
                    {dir && <span className="cy-review-panel__dir">{dir}</span>}
                    <span className="cy-review-panel__base">{base}</span>
                  </span>
                  <span className="cy-review-panel__file-stats">
                    {file.additions > 0 && <span className="is-add">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="is-remove">−{file.deletions}</span>}
                  </span>
                  <svg className="cy-review-panel__arrow" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
                  </svg>
                </button>
              );
            })}
          </div>
          <LLMReviewCard runId={runId} />
        </>
      )}
    </section>
  );
}
