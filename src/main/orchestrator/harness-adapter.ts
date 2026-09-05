/**
 * CyreneHarness ↔ CyreneAgent 适配层
 *
 * 把 CyreneRunOptions 转换为 HarnessInput，运行 Harness，
 * 再把 HarnessEvent 转为 AG-UI BaseEvent，HarnessResult 转为 AgentLoopResult。
 *

 */

import type { BaseEvent } from "@ag-ui/core";
import { runCyreneHarness } from "./harness";
import type { HarnessEvent, HarnessInput } from "./harness";
import type { AgentLoopResult } from "./cyrene-agent";
import type { CyreneRunOptions, AgentLoopSettings } from "./cyrene-agent";
import type { ToolCallResult } from "./types";
import { mapTerminateReason, mapTerminateReasonToTerminal } from "./harness/adapter/terminal-mapper";
export { mapTerminateReasonToTerminal } from "./harness/adapter/terminal-mapper";
export {
  buildHarnessPromptLayers,
  buildHarnessSystemPrompt,
  materializeHarnessStartTranscript,
} from "./harness/adapter/prompt-builder";
import { app } from "electron";
import { getRunReviewTracker } from "./review/run-review-tracker";
import { runLLMReview, saveLLMReview, hasLLMReview, type LLMCallFn } from "./review/llm-reviewer";
import { runSkillCreation, type SkillCreationInput, type LLMCallFn as SkillLLMCallFn } from "../self-evolving/skill-creation";
import type { ReviewRunStatus } from "../../shared/review-types";
import { sendHarnessEventAsAgui } from "./harness/adapter/event-mapper";
export { sendHarnessEventAsAgui, sendTaskLifecycleAsAgui } from "./harness/adapter/event-mapper";
import { completePlanRun } from "./harness/adapter/plan-lifecycle";
import { prepareHarnessRun } from "./harness/adapter/run-preparation";
import { prepareToolRuntime } from "./harness/adapter/tool-runtime";

const LOG_PREFIX = "[HarnessAdapter]";
export { filterToolsForConversationMode } from "./harness/adapter/run-preparation";

// ── LLM 审查回调（可注入，默认不启用） ─────────────────────
// 设计：模块级可注入回调，不修改 runHarnessWithAdapter 函数签名。
// 调用方（如 bootstrap）通过 setLLMReviewCallback 注入真实的 LLM 调用函数后启用。
// 未注入时，finalizeReview 之后不会触发 LLM 审查，保持原有行为。
type LLMReviewCallback = (snapshot: import("../../shared/review-types").ReviewSnapshot) => Promise<void>;
let llmReviewCallback: LLMReviewCallback | null = null;

/**
 * 注入 LLM 审查回调。传入 null 可禁用审查。
 * 回调应在后台异步执行审查并持久化结果，不应阻塞 Run 结果返回。
 */
export function setLLMReviewCallback(callback: LLMReviewCallback | null): void {
  llmReviewCallback = callback;
  console.log(`${LOG_PREFIX} LLM review callback ${callback ? "enabled" : "disabled"}`);
}

/**
 * 构建默认的 LLM 审查回调（使用给定的 LLM 调用函数）。
 * 方便调用方直接使用，不需要自己实现回调逻辑。
 */
export function buildDefaultLLMReviewCallback(
  llmCall: LLMCallFn,
  model?: string,
): LLMReviewCallback {
  return async (snapshot) => {
    const userDataRoot = app.getPath("userData");
    // 幂等：已有审查结果则跳过
    if (hasLLMReview(userDataRoot, snapshot.runId)) {
      console.log(`${LOG_PREFIX} LLM review already exists for runId=${snapshot.runId}, skipping`);
      return;
    }
    try {
      const result = await runLLMReview(snapshot, llmCall, model);
      saveLLMReview(userDataRoot, result);
      console.log(`${LOG_PREFIX} LLM review completed for runId=${snapshot.runId}, status=${result.status}, avgScore=${result.overallQualityScore}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} LLM review failed for runId=${snapshot.runId}: ${msg}`);
    }
  };
}

// ── 自动技能沉淀回调（可注入，默认不启用） ───────────────────
// 与 LLM 审查同模式：模块级可注入回调，Run 结束后在后台触发。
// 通过 setSkillCreationCallback 注入真实 LLM 调用函数后启用。
type SkillCreationCallback = (input: SkillCreationInput) => Promise<void>;
let skillCreationCallback: SkillCreationCallback | null = null;

/**
 * 注入自动技能沉淀回调。传入 null 可禁用。
 * 回调应在后台异步执行，不应阻塞 Run 结果返回。
 */
export function setSkillCreationCallback(callback: SkillCreationCallback | null): void {
  skillCreationCallback = callback;
  console.log(`${LOG_PREFIX} skill creation callback ${callback ? "enabled" : "disabled"}`);
}

/**
 * 构建默认的技能沉淀回调（使用给定的 LLM 调用函数）。
 */
export function buildDefaultSkillCreationCallback(llmCall: SkillLLMCallFn): SkillCreationCallback {
  return async (input) => {
    try {
      const outcome = await runSkillCreation(input, llmCall);
      console.log(`${LOG_PREFIX} skill creation outcome for runId=${input.runId}: ${outcome.status}${outcome.skillName ? ` (${outcome.skillName})` : ""}${outcome.detail ? ` - ${outcome.detail}` : ""}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} skill creation failed for runId=${input.runId}: ${msg}`);
    }
  };
}

// 兼容门面（facade）：旧调用方继续从本文件导入；具体职责下沉到 adapter/ 下的叶子模块。
// 门面只保留公共导出和编排顺序，不重新维护 Map、缓存或控制器等运行状态。

/**
 * 运行 CyreneHarness 并返回统一的 AgentLoopResult。
 *
 * @param options CyreneRunOptions（与旧循环相同的输入）
 * @param signal 取消信号
 * @param sendBaseEvent 直接发送 AG-UI BaseEvent 的回调
 */
export async function runHarnessWithAdapter(
  options: CyreneRunOptions,
  signal: AbortSignal,
  sendBaseEvent: (event: BaseEvent) => void,
): Promise<AgentLoopResult> {
  // 准备阶段创建唯一的 runStore 实例；checkpoint、工具生命周期和终态都写入它。
  const prepared = await prepareHarnessRun(options, signal);
  const {
    messageId,
    runId,
    threadId,
    planState,
    vendorConfig,
    tools,
    runStore,
    recovered,
    promptLayers,
    harnessPromptLayers,
    systemPrompt,
    runMessages,
  } = prepared;

  const toolRuntime = prepareToolRuntime({ options, signal, prepared, sendBaseEvent });
  const { toolContext, checkPermission, toolOutputStore, taskExecutor, taskGroupExecutor } = toolRuntime;

  // ── 构建 HarnessInput ──
  const harnessInput: HarnessInput = {
    systemPrompt,
    promptLayers: harnessPromptLayers,
    usageParts: promptLayers.usageParts,
    messages: runMessages,
    runId,
    ...(recovered ? { initialState: recovered.state } : {}),
    ...(recovered ? { initialCache: recovered.cache } : {}),
    tools,
    vendorConfig,
    config: {
      maxParallelToolCalls: options.maxParallelToolCalls,
      // 0 表示禁用整轮执行时钟；单次模型/工具超时仍由各自策略处理。
      totalTimeoutMs: 0,
      contextWindowTokens: options.settings.contextWindowTokens,
    },
    signal,
    onEvent: (event: HarnessEvent) => {
      if (!signal.aborted) {
        sendHarnessEventAsAgui(event, messageId, threadId, runId, sendBaseEvent);
      }
    },
    onCheckpoint: (checkpoint) => {
      runStore.checkpoint(runId, {
        messages: checkpoint.messages,
        state: checkpoint.state,
        toolOutputs: checkpoint.toolOutputs,
        rounds: checkpoint.rounds,
      });
    },
    onToolLifecycle: (event) => {
      runStore.recordTool(runId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        sideEffect: event.toolSideEffect,
        status: event.status,
      });
    },
    onCompactionLifecycle: (event) => runStore.recordCompaction(runId, event),
    requestUserClarification: options.requestUserClarification
      ? (card) => options.requestUserClarification!(card as never, signal)
      : undefined,
    includeInteractiveTools: options.harnessInteractiveTools,
    planState,
    toolContext,
    toolOutputStore,
    executionLedger: options.executionLedger,
    checkPermission,
    taskExecutor,
    taskGroupExecutor,
  };

  // ── 运行 Harness ──
  // 这是唯一的真实执行边界。事件回调只负责同步转发，业务状态仍由各自的所有者维护。
  const result = await runCyreneHarness(harnessInput);

  // ── 转换结果 ──
  const completionReason = mapTerminateReason(result.terminateReason);
  // 把 HarnessResult.terminateReason 映射为 canonical terminal，
  // 供 CyreneAgent.runWithEvents 写入 RUN_FINISHED.result。
  // 优先使用 harness 自身填的 result.terminal（如果未来 harness 内部直接写）。
  // 修订：success 路径必须消费 Harness 的确定性状态——
  // 若 finalState.uncertainEffects 非空，externalEffectsMayContinue 必须为 true，
  // 即使 status=success 也不能谎报 false（unknown-side-effect 的诚实 final 是允许的）。
  const hasUncertainEffects = result.finalState.uncertainEffects.length > 0;
  const terminal = result.terminal ?? mapTerminateReasonToTerminal(
    result.terminateReason,
    hasUncertainEffects,
  );
  const terminalRunStatus = terminal.status === "success"
    ? "completed"
    : terminal.status === "cancelled" ? "cancelled" : "failed";
  // 终态持久化必须先于 Review 收尾：Review 读取的是刚写入的不可变 run 结果。
  const finalSession = runStore.markTerminal(runId, terminalRunStatus);

  // ── Review 快照：Run 终止时生成不可变 ReviewSnapshot ──
  // 正常终止时主动 finalize；崩溃恢复（interrupted）的 Run 由前端打开 Review 时
  // 通过 finalizeIfPending 按需补生成。
  let reviewSnapshot: import("../../shared/review-types").ReviewSnapshot | null = null;
  try {
    const tracker = getRunReviewTracker(app.getPath("userData"));
    const reviewStatus: ReviewRunStatus = terminalRunStatus;
    reviewSnapshot = tracker.finalizeReview(runId, finalSession.createdAt, reviewStatus);
  } catch (err) {
    // Review 生成失败不应阻塞 Run 结果返回
    console.error(`${LOG_PREFIX} finalizeReview failed:`, err);
  }

  // ── 后台 LLM 审查（可选，需通过 setLLMReviewCallback 注入） ──
  // 异步触发，不阻塞 Run 结果返回。未注入回调时跳过。
  if (reviewSnapshot && llmReviewCallback) {
    // 不 await：后台执行，不阻塞
    llmReviewCallback(reviewSnapshot).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} LLM review callback threw: ${msg}`);
    });
  }

  // ── 自动技能沉淀（可选，需通过 setSkillCreationCallback 注入） ──
  // 异步触发；从 runStore 读取工具调用轨迹，配合 Review 快照组装沉淀输入。
  if (skillCreationCallback) {
    const session = runStore.get(runId);
    const creationInput: SkillCreationInput = {
      runId,
      status: terminalRunStatus,
      rounds: session?.rounds ?? result.rounds,
      toolCalls: (session?.toolCalls ?? []).map((call) => ({ toolName: call.toolName, status: call.status })),
      finalAnswer: result.finalAnswer,
      files: reviewSnapshot?.files ?? [],
      conversationMode: options.conversationMode,
    };
    // 不 await：后台执行，不阻塞
    skillCreationCallback(creationInput).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} skill creation callback threw: ${msg}`);
    });
  }

  // ── 计划模式 run 尾钩──
  // 执行 run 结束（无论成败/取消）自动摘牌回 NORMAL；planPath 供前端"施工已完成"标注。
  // PLAN_DISCUSSING → PLAN_REVIEW 的转换不在 adapter 做：审批流由 agui-bridge 在
  // RUN_FINISHED 之后触发（需要 buildOptions 重开执行 run 的能力）。
  completePlanRun({
    mode: options.conversationMode,
    threadId,
    runId,
    runStatus: terminalRunStatus,
    signal,
    send: sendBaseEvent,
  });

  const toolResults: ToolCallResult[] = [];

  console.log(
    `${LOG_PREFIX} harness run complete, rounds=${result.rounds} terminated=${result.terminated} terminal=${terminal.status}`,
  );

  return {
    reply: result.finalAnswer,
    toolResults,
    completionReason,
    terminal,
    totalUsage: undefined,
  };
}
