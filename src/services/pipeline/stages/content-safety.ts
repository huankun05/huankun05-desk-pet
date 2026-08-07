/**
 * ContentSafetyStage — 内容安全检查管道阶段
 *
 * 位于 MemoryStage 和 LLMStage 之间。
 * 对用户输入执行安全检查，失败时中止管道并通知 UI。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import type { Message } from '../../../components/Chat/ChatWindow';
import { safetyChecker } from '../../safety';

export class ContentSafetyStage implements Stage {
  readonly name = 'ContentSafety';

  async process(ctx: MessageContext, callbacks: PipelineCallbacks): Promise<void> {
    if (!safetyChecker.isEnabled()) {
      return;
    }

    const result = safetyChecker.check(ctx.userText, ctx.session.id);
    if (!result.ok) {
      ctx.aborted = true;

      // 保存一条系统消息记录被阻止
      const blockedMessage: Message = {
        id: ctx.assistantMessageId,
        role: 'assistant',
        content: `\u26a0\ufe0f \u6d88\u606f\u5df2\u88ab\u5185\u5bb9\u5b89\u5168\u68c0\u67e5\u62e6\u622a\uff1a${result.reason}`,
        timestamp: new Date(),
      };
      callbacks.onSaveMessage(blockedMessage);
      callbacks.onStreamChunk(ctx.assistantMessageId, blockedMessage.content);
    }
  }
}
