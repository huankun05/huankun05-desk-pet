import type { TaskSessionStatus, TaskSubagentType, TaskTranscriptMessage } from "../../shared/task-session";
import { TaskSessionStore } from "../tasks/task-session-store";
import { projectTaskTraceEvent } from "./task-events";
import { getTaskAgentProfile, resolveTaskTools } from "./task-profiles";
import { runCyreneHarness } from "./harness/cyrene-harness";
import type { HarnessInput, HarnessResult } from "./harness/types";
import type { ToolDefinition } from "./tools/registry/tool-registry";
import type { VendorConfig, ChatMessage } from "./vendors/types";
import type { ToolContext } from "./tools/registry/tool-context";
import { taskCharacterLeasePool, type TaskCharacterLeasePool } from "../tasks/task-character-pool";
import type { TaskDelegationPresentation } from "../../shared/task-session";
import type { RunCapabilities } from "./run-capabilities";
import type { PromptLayers } from "./prompt-layers";
import type { ToolOutputStore } from "./harness/tool-output/tool-output-store";

export interface TaskExecuteRequest {
  description: string;
  prompt: string;
  subagentType: TaskSubagentType;
  companionId: string;
  taskId?: string;
}

export interface TaskExecuteResult {
  taskId: string;
  status: TaskSessionStatus;
  text: string;
}

/** 并行子任务组的执行请求：一次聚合多个独立子任务。 */
export interface TaskGroupExecuteRequest {
  tasks: TaskExecuteRequest[];
  /** 并发上限；缺省用 DEFAULT_TASK_GROUP_MAX_PARALLEL，且不超过任务数。 */
  maxParallel?: number;
}

/** 并行子任务组的聚合结果：results 与 tasks 输入顺序一一对齐。 */
export interface TaskGroupExecuteResult {
  results: TaskExecuteResult[];
}

/** 并行子任务默认并发上限（对应 Harness 保守并行调度的默认 4）。 */
export const DEFAULT_TASK_GROUP_MAX_PARALLEL = 4;

export interface TaskRuntimeParentContext {
  parentConversationId: string;
  parentRunId: string;
  mode: "work" | "code";
  systemPrompt: string;
  vendorConfig: VendorConfig;
  tools: ToolDefinition[];
  capabilities?: RunCapabilities;
  resolvedWorkspaceRoot?: string;
  signal?: AbortSignal;
  checkPermission?: HarnessInput["checkPermission"];
  includeInteractiveTools?: boolean;
  permissionMode?: import("./cyrene-agent").CyreneRunOptions["permissionMode"];
  toolOutputStore?: ToolOutputStore;
}

function taskStatus(result: HarnessResult): { status: Exclude<TaskSessionStatus, "running" | "interrupted">; error?: { code: string; message: string } } {
  const terminal = result.terminal?.status;
  if (terminal === "cancelled" || result.terminateReason === "cancelled") return { status: "cancelled" };
  if (terminal === "timeout" || result.terminateReason === "timeout") {
    return { status: "failed", error: { code: "TASK_TIMEOUT", message: "子任务超过执行时间上限" } };
  }
  if (terminal === "runtime_error" || result.terminateReason === "error") {
    return { status: "failed", error: { code: "TASK_RUNTIME_ERROR", message: result.finalAnswer || "子任务运行失败" } };
  }
  return { status: "completed" };
}

export function buildChildPromptLayers(parent: TaskRuntimeParentContext, profilePrompt: string): PromptLayers {
  const workspace = parent.resolvedWorkspaceRoot
    ? `可信工作目录：${parent.resolvedWorkspaceRoot}`
    : "当前没有绑定工作目录。";
  return {
    stablePrefix: profilePrompt,
    sessionPrefix: `${workspace}\n会话模式：${parent.mode}`,
    mode: parent.mode,
  };
}

/** 单个子任务执行所需的最小依赖集合；单任务执行器与并行组执行器共享。 */
interface TaskRuntimeDeps {
  parent: TaskRuntimeParentContext;
  store: TaskSessionStore;
  runHarness: typeof runCyreneHarness;
  characterPool: Pick<TaskCharacterLeasePool, "acquire">;
  onLifecycle?: (event: TaskDelegationPresentation) => void;
}

/**
 * 执行单个前台子任务：创建/恢复会话 → 租角色 → 跑子 Harness → 结算落盘 → 释放角色。
 * 业务错误（含父会话不匹配、角色正忙、子 Harness 失败）统一在会话已创建后
 * 落盘为 failed/cancelled 并**上抛**，由调用方决定单任务拒绝还是组内隔离。
 */
async function runSingleTask(deps: TaskRuntimeDeps, request: TaskExecuteRequest): Promise<TaskExecuteResult> {
  const { parent, store, runHarness, characterPool, onLifecycle } = deps;
  const profile = getTaskAgentProfile(request.subagentType);
  const session = request.taskId
    ? store.resume(request.taskId, {
        parentConversationId: parent.parentConversationId,
        parentRunId: parent.parentRunId,
        subagentType: request.subagentType,
        prompt: request.prompt,
      })
    : store.create({
        parentConversationId: parent.parentConversationId,
        parentRunId: parent.parentRunId,
        description: request.description,
        prompt: request.prompt,
        subagentType: request.subagentType,
        mode: parent.mode,
        resolvedWorkspaceRoot: parent.resolvedWorkspaceRoot,
      });

  const toolContext: ToolContext = {
    userQuery: request.prompt,
    conversationId: parent.parentConversationId,
    runId: session.childRunId,
    signal: parent.signal,
    resolvedWorkspaceRoot: parent.resolvedWorkspaceRoot,
    mode: parent.mode,
    allowedSkillIds: parent.capabilities?.skillIds,
    permissionMode: parent.permissionMode,
  };

  const lease = characterPool.acquire(parent.parentConversationId, request.companionId);
  const presentation = {
    invocationId: session.childRunId,
    taskId: session.id,
    description: request.description,
    nickname: lease.nickname,
    assetFileName: lease.assetFileName,
  };
  onLifecycle?.({ ...presentation, status: "running" });

  try {
    const promptLayers = buildChildPromptLayers(parent, profile.systemPrompt);
    const result = await runHarness({
      systemPrompt: promptLayers.stablePrefix,
      promptLayers,
      messages: session.messages as ChatMessage[],
      tools: resolveTaskTools(profile, parent.tools),
      vendorConfig: parent.vendorConfig,
      config: { totalTimeoutMs: profile.timeoutMs },
      initialState: {
        todoItems: session.todoItems,
        uncertainEffects: [],
      },
      signal: parent.signal,
      toolContext,
      toolOutputStore: parent.toolOutputStore,
      checkPermission: parent.checkPermission,
      includeInteractiveTools: parent.includeInteractiveTools,
      onEvent: (event) => {
        const trace = projectTaskTraceEvent(event);
        if (trace) {
          const current = store.get(session.id);
          if (current) store.checkpoint(session.id, { trace: [...current.trace, trace] });
        }
      },
      onCheckpoint: (checkpoint) => {
        store.checkpoint(session.id, {
          messages: checkpoint.messages as TaskTranscriptMessage[],
          todoItems: checkpoint.state.todoItems,
        });
      },
    });
    const mapped = taskStatus(result);
    store.checkpoint(session.id, {
      status: mapped.status,
      resultText: result.finalAnswer,
      todoItems: result.finalState.todoItems,
      ...(mapped.error ? { error: mapped.error } : {}),
      completedAt: Date.now(),
    });
    onLifecycle?.({ ...presentation, status: mapped.status });
    return { taskId: session.id, status: mapped.status, text: result.finalAnswer };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.checkpoint(session.id, {
      status: parent.signal?.aborted ? "cancelled" : "failed",
      error: { code: parent.signal?.aborted ? "TASK_CANCELLED" : "TASK_RUNTIME_ERROR", message },
      completedAt: Date.now(),
    });
    onLifecycle?.({ ...presentation, status: parent.signal?.aborted ? "cancelled" : "failed" });
    throw error;
  } finally {
    lease.release();
  }
}

function buildTaskRuntimeDeps(input: {
  parent: TaskRuntimeParentContext;
  store: TaskSessionStore;
  runHarness?: typeof runCyreneHarness;
  characterPool?: Pick<TaskCharacterLeasePool, "acquire">;
  onLifecycle?: (event: TaskDelegationPresentation) => void;
}): TaskRuntimeDeps {
  return {
    parent: input.parent,
    store: input.store,
    runHarness: input.runHarness ?? runCyreneHarness,
    characterPool: input.characterPool ?? taskCharacterLeasePool,
    onLifecycle: input.onLifecycle,
  };
}

export function createTaskExecutor(input: {
  parent: TaskRuntimeParentContext;
  store: TaskSessionStore;
  runHarness?: typeof runCyreneHarness;
  characterPool?: Pick<TaskCharacterLeasePool, "acquire">;
  onLifecycle?: (event: TaskDelegationPresentation) => void;
}): (request: TaskExecuteRequest) => Promise<TaskExecuteResult> {
  const deps = buildTaskRuntimeDeps(input);
  return (request) => runSingleTask(deps, request);
}

/**
 * 并行子任务执行器：以 maxParallel（默认 4）并发上限调度多个独立子任务，
 * 单个子任务失败/取消不影响其余；结果按输入顺序对齐。
 * 每个子任务仍然走独立的 TaskSessionStore 会话、checkpoint 与角色租约。
 */
export function createTaskGroupExecutor(input: {
  parent: TaskRuntimeParentContext;
  store: TaskSessionStore;
  runHarness?: typeof runCyreneHarness;
  characterPool?: Pick<TaskCharacterLeasePool, "acquire">;
  onLifecycle?: (event: TaskDelegationPresentation) => void;
}): (request: TaskGroupExecuteRequest) => Promise<TaskGroupExecuteResult> {
  const deps = buildTaskRuntimeDeps(input);
  return async (request) => {
    const tasks = Array.isArray(request.tasks) ? request.tasks : [];
    if (tasks.length === 0) throw new Error("TASK_GROUP_EMPTY");
    const maxParallel = Math.max(
      1,
      Math.min(
        Number.isFinite(request.maxParallel) && request.maxParallel !== undefined
          ? Math.floor(request.maxParallel)
          : DEFAULT_TASK_GROUP_MAX_PARALLEL,
        tasks.length,
      ),
    );

    const results = new Array<TaskExecuteResult>(tasks.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        const task = tasks[index];
        try {
          results[index] = await runSingleTask(deps, task);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results[index] = {
            taskId: task.taskId ?? "",
            status: deps.parent.signal?.aborted ? "cancelled" : "failed",
            text: message,
          };
        }
      }
    };
    await Promise.all(Array.from({ length: maxParallel }, worker));
    return { results };
  };
}
