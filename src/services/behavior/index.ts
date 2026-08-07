/**
 * Behavior System — barrel export
 *
 * 行为系统提供 DeskPetBehavior 基类 + 自注册 + 事件驱动 + 依赖注入。
 *
 * 状态（2026-07-30）：已集成到主应用
 * - 内置 5 个行为：回归问候 / 情绪共鸣 / 空闲闲聊 / 离别提醒 / 好感度里程碑
 *   （在 builtins.ts import 即可自动注册）
 * - App.tsx 构造 PetContextImpl 注入 TTS/气泡/Live2D 能力，启动时 initializeAll
 * - eventBus 事件（message:sent/response、emotion/favorability/persona 变化、
 *   window focus/blur、6min 空闲定时器）统一转发到 registry.dispatch
 * - BehaviorRegistry 支持 setEnabled / isEnabled，配置持久化到 localStorage
 * - 设置面板 BehaviorPage 增加"内置行为管理" Section + RAG 长期记忆开关
 */

// 基类 + 自注册
export { DeskPetBehavior, BehaviorLifecycle } from './base';

// 注册表
export { BehaviorRegistry, getBehaviorRegistry, resetBehaviorRegistry } from './registry';

// 依赖注入
export { PetContextImpl } from './context';
export type { PetContext, PetContextDependencies } from './context';

// 类型
export { EventType, FilterAction } from './types';
export type { BehaviorHandler, HandlerFilter } from './types';
export { RegexFilter, FavorabilityFilter, CommandFilter, CustomFilter } from './types';
