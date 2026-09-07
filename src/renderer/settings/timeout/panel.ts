// Timeout 面板业务逻辑：超时配置加载 / 保存 / 重置按钮绑定
// 从 settings.ts 抽离。依赖 timeout DOM 引用（./dom）、api DOM 引用（../api/dom，复用 modelRequestTimeoutSec*）。
// saveTimeoutSettings 导出供 settings.ts 的 API 表单处理器调用（跨面板共享保存逻辑）。

import {
  timeoutUserChoiceInput, timeoutUserChoiceReset,
  timeoutTestInput, timeoutTestReset,
  maxParallelToolCallsInput,
} from "./dom";
import { modelRequestTimeoutSecInput, modelRequestTimeoutSecReset } from "../api/dom";
import { setSaveStatus, setRuntimeSaveStatus } from "../shared/save-status";
import { parsePositiveIntOrThrow } from "../shared/parse";
import { tOr } from "../i18n";
import type { TimeoutSettings } from "../../../shared/timeout-types";

export async function loadTimeoutSettings(): Promise<void> {
  try {
    const cfg = await window.settings!.getTimeoutSettings();
    timeoutUserChoiceInput.value = String(cfg.userChoiceTimeout / 1000);
    timeoutTestInput.value = String(cfg.testTimeout);
    modelRequestTimeoutSecInput.value = cfg.modelRequestTimeoutSec != null ? String(cfg.modelRequestTimeoutSec) : "";
    const generalSettings = await window.settings!.getGeneral();
    maxParallelToolCallsInput.value = String(generalSettings.maxParallelToolCalls ?? 4);
    setRuntimeSaveStatus(tOr("timeout.effectiveNote", "时间设置保存后，对后续请求生效。"));
  } catch {
    setRuntimeSaveStatus(tOr("timeout.loadFailed", "读取偏好失败"), "is-error");
  }
}

export async function saveTimeoutSettings(saveTestTimeout: boolean): Promise<boolean> {
  let settings: Partial<TimeoutSettings>;
  try {
    if (!saveTestTimeout) {
      settings = {
        userChoiceTimeout: 1000 * parsePositiveIntOrThrow(timeoutUserChoiceInput.value, tOr("timeout.userChoiceTimeout", "询问等待时间")),
        modelRequestTimeoutSec: modelRequestTimeoutSecInput.value === "" ? undefined : parsePositiveIntOrThrow(modelRequestTimeoutSecInput.value, tOr("timeout.modelRequestTimeout", "模型请求超时")),
      };
    } else {
      settings = {
        testTimeout: parsePositiveIntOrThrow(timeoutTestInput.value, tOr("timeout.testTimeout", "测试超时")),
      };
    }
  } catch (e) {
    if (saveTestTimeout) {
      setSaveStatus(tOr("timeout.invalidInput", "无效输入：") + e, "is-error");
    } else {
      setRuntimeSaveStatus(tOr("timeout.invalidInput", "无效输入：") + e, "is-error");
    }
    return false;
  }
  try {
    await window.settings!.saveTimeoutSettings(settings);
    if (!saveTestTimeout) {
      const requested = Number(maxParallelToolCallsInput.value);
      await window.settings!.saveGeneral({
        maxParallelToolCalls: Number.isFinite(requested) ? requested : 4,
      });
    }
    if (saveTestTimeout) {
      setSaveStatus(tOr("common.saved", "已保存"), "is-ok");
    } else {
      setRuntimeSaveStatus(tOr("common.saved", "已保存"), "is-ok");
    }
    return true;
  } catch {
    if (saveTestTimeout) {
      setSaveStatus(tOr("common.saveFailed", "保存失败"), "is-error");
    } else {
      setRuntimeSaveStatus(tOr("common.saveFailed", "保存失败"), "is-error");
    }
  }
  return false;
}

// ===== 重置按钮事件绑定（模块加载时执行） =====
timeoutTestReset.addEventListener("click", () => { timeoutTestInput.value = "15000" });
timeoutUserChoiceReset.addEventListener("click", () => { timeoutUserChoiceInput.value = "60" });
modelRequestTimeoutSecReset.addEventListener("click", () => { modelRequestTimeoutSecInput.value = "" });

// 模块加载时拉一次配置
void loadTimeoutSettings();
