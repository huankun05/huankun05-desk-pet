/**
 * behaviorConfig — 角色行为配置（单一数据源）
 *
 * 全局唯一的行为配置存储，key 为 `deskpet_behaviorConfig`。
 * 多处（设置页、互动 Hook、思考标签解析、Provider 系统提示构建）均从这里读取，
 * 避免重复定义导致的不一致。
 *
 * 其中 `enableThinkTags`（内心独白）是本文件作为唯一真相来源：
 * - 模型侧：OpenAIChatProvider.getSystemPrompt 读取它来注入 <think> 指令；
 * - TTS 侧：ThinkParseStage 读取它来决定是否剥离 <think> 标签。
 * 因此"内心独白"在 UI 上只有一个开关，同时控制这两处。
 */

export interface BehaviorConfig {
  /** 内心独白：是否注入 <think> 指令并参与 TTS 剥离（默认开启） */
  enableThinkTags: boolean;
  /** 主动聊天（原智能闲聊） */
  enableSmartChat: boolean;
  /** 主动聊天间隔（秒） */
  smartChatInterval: number;
  /** 主动聊天每日上限（次） */
  smartChatDailyLimit: number;
  /** 行为总开关 */
  enable: boolean;
}

export const DEFAULT_BEHAVIOR: BehaviorConfig = {
  enableThinkTags: true,
  enableSmartChat: false,
  smartChatInterval: 60,
  smartChatDailyLimit: 20,
  enable: true,
};

export const BEHAVIOR_STORAGE_KEY = 'deskpet_behaviorConfig';

/** 读取行为配置，缺失字段用默认值补齐 */
export function loadBehaviorConfig(): BehaviorConfig {
  try {
    const raw = localStorage.getItem(BEHAVIOR_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_BEHAVIOR, ...(JSON.parse(raw) as Partial<BehaviorConfig>) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_BEHAVIOR };
}

/** 持久化行为配置 */
export function saveBehaviorConfig(config: BehaviorConfig): void {
  localStorage.setItem(BEHAVIOR_STORAGE_KEY, JSON.stringify(config));
}
