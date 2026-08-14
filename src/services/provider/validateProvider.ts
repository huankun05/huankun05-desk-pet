import { providerRegistry } from './registry';
import type { ChatProviderConfig, TTSProviderConfig, STTProviderConfig } from './types';

/**
 * 通用 provider 配置校验：用临时 id 创建一个 provider 实例并调用其 validate()。
 * 成功 resolve，失败 reject（抛出可读错误）。供配置向导的「测试连接」复用，
 * 避免每个服务页重复编写 createProvider + validate 的样板。
 *
 * 注意：Embedding 后端按 apiBase 在 Ollama/OpenAI 间二选一、不走注册表，
 * 因此 Embedding 页面需自行传入 custom validate。
 */
export async function validateProviderConfig(
  serviceType: 'chat' | 'tts' | 'stt',
  config: ChatProviderConfig | TTSProviderConfig | STTProviderConfig,
): Promise<void> {
  const tempId = `temp-probe-${crypto.randomUUID()}`;
  const testConfig = { ...config, id: tempId, enable: true };

  const provider =
    serviceType === 'chat'
      ? providerRegistry.createChatProvider(testConfig.typeName, testConfig as ChatProviderConfig)
      : serviceType === 'tts'
        ? providerRegistry.createTTSProvider(testConfig.typeName, testConfig as TTSProviderConfig)
        : providerRegistry.createSTTProvider(testConfig.typeName, testConfig as STTProviderConfig);

  if (!provider) {
    throw new Error('无法创建该类型的 Provider 适配器');
  }
  await provider.validate();
}
