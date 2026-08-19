/**
 * 网关工具执行器（共享）
 *
 * 订阅事件总线 'tool:execute'（由 Hermes Gateway 在需要前端执行工具时下发），
 * 统一通过 **已加权限网关的** `toolRegistry.execute` 执行，再把结果回传 Gateway。
 *
 * 聊天面板与主控窗口各自注册一份（不同 webview 独立 JS 上下文），
 * 保证语音 / 打字两种入口触发的工具都经过权限确认。
 */

import { eventBus } from '../eventBus';
import { toolRegistry } from './registry';

export type SendToolResult = (id: string, name: string, content: string, isError?: boolean) => void;

/**
 * 注册网关工具执行器。
 * @returns 取消订阅函数
 */
export function registerGatewayToolExecutor(sendResult: SendToolResult): () => void {
  return eventBus.on('tool:execute', async (payload) => {
    const { id, name, args } = payload as {
      id: string;
      name: string;
      args: Record<string, unknown>;
    };
    const tool = toolRegistry.get(name);
    if (!tool) {
      sendResult(id, name, `Error: unknown tool '${name}'`, true);
      return;
    }
    try {
      // toolRegistry.execute 内部已含权限网关（authorize）
      const result = await toolRegistry.execute({ id, name, arguments: args });
      sendResult(id, name, result.content, result.isError ?? false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendResult(id, name, `Error: ${message}`, true);
    }
  });
}
