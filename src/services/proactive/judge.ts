/**
 * 主动消息裁决器 — 补上 Miru 缺失的"该不该说"一票否决层。
 *
 * 定位：调度器的硬规则（冷却 / 每日上限 / 免打扰 / 忙碌闸）负责"绝对不能说"，
 * 本裁决器负责"能说但此刻不合适"这类软判断。两者是串联关系，硬规则先过，
 * 裁决器再投一票，任一否决即沉默。
 *
 * 成本控制：
 * - 走 aiService.quickDecide（temperature=0 / maxTokens=8），单次成本远低于生成一条消息
 * - 调度器侧已按 dailyLimit * 3 封顶调用次数
 * - 超时/异常一律降级放行：硬规则既已判定该说，不该因裁决链路故障而彻底沉默
 */

import { aiService } from '../ai';
import type { ChatMessage } from '../provider/types';
import { createLogger } from '../../utils/logger';
import type { ProactiveJudge, ProactiveJudgeContext } from './scheduler';

const log = createLogger('ProactiveJudge');

/** 裁决超时（毫秒）：超时按放行处理，避免 judging 标志被挂死请求长期占用 */
const JUDGE_TIMEOUT = 8000;

const TREND_LABEL: Record<ProactiveJudgeContext['emotionTrend'], string> = {
  positive: '偏积极',
  negative: '偏低落',
  neutral: '平稳',
};

const SYSTEM_PROMPT = [
  '你是桌面宠物的"打扰把关人"。系统已根据硬规则提议现在主动对用户说一句话，',
  '你要判断此刻打扰是否合适。',
  '',
  '否决的情形：用户看起来正专注工作、今天已经被搭话多次、场景理由牵强、深夜或用户可能在休息。',
  '放行的情形：确实到了值得关心的节点，且今天打扰次数还少。',
  '',
  '只回答一个词：YES（放行）或 NO（否决）。不要解释。',
].join('\n');

function buildUserPrompt(ctx: ProactiveJudgeContext): string {
  const lines = [
    `场景：${ctx.scene.label}（${ctx.scene.id}）`,
    `触发条件：${ctx.scene.condition}`,
    `触发理由：${ctx.reason}`,
    `当前时间：${ctx.hour} 点`,
    `距上次互动：${ctx.idleMinutes} 分钟`,
    `近期情绪：${TREND_LABEL[ctx.emotionTrend]}`,
    `今日已主动搭话：${ctx.todayCount} 次`,
    `今日对话轮次：${ctx.todayTurns} 轮`,
    `昼夜主动系数：${ctx.initiativeMultiplier.toFixed(2)}${ctx.initiativeMultiplier < 0.6 ? '（偏低，应更克制）' : ''}`,
  ];
  if (ctx.hints.length > 0) {
    lines.push(`上下文：${ctx.hints.join('；')}`);
  }
  lines.push('', '现在该说话吗？只回 YES 或 NO。');
  return lines.join('\n');
}

/** 解析模型输出。判定不出结果时放行，与整体 fail-open 策略一致。 */
function parseVerdict(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  if (!text) return true;
  // 先查否决词：模型可能输出 "NO，用户在忙" 这种带解释的形式
  if (/\bno\b|^no|不合适|否决|不要|别/.test(text)) return false;
  if (/\byes\b|^yes|合适|可以|放行/.test(text)) return true;
  log.warn('Unrecognized judge verdict, allowing', { raw: raw.slice(0, 40) });
  return true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('judge timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 默认裁决器：一次廉价模型调用决定是否放行。
 *
 * 注入方式见 MainPetApp：`proactiveScheduler.setJudge(llmProactiveJudge)`。
 * 是否真正生效由 `config.judgeEnabled`（设置页「智能裁决」开关）控制。
 */
export const llmProactiveJudge: ProactiveJudge = async (ctx) => {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(ctx) },
  ];
  try {
    const raw = await withTimeout(aiService.quickDecide(messages), JUDGE_TIMEOUT);
    const approved = parseVerdict(raw);
    log.info('Judge verdict', { scene: ctx.scene.id, approved, raw: raw.trim().slice(0, 20) });
    return approved;
  } catch (err) {
    // 抛给调度器，由其统一按"放行"降级并记录日志
    throw err instanceof Error ? err : new Error(String(err));
  }
};
