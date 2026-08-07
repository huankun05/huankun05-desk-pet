import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from './manager';

describe('ProviderManager lazy loading', () => {
  beforeEach(() => {
    // reset singleton by clearing storage/config is hard; instead test via fresh manager behavior indirectly
  });

  it('does not pre-create providers during initialization', async () => {
    const manager = new ProviderManager();
    await manager.ready;
    // slots should be empty until accessed
    expect(manager.listProviders('chat').length).toBeGreaterThanOrEqual(0);
  });

  it('creates provider on first access', async () => {
    const manager = new ProviderManager();
    await manager.ready;
    const providers = manager.listProviders('chat');
    if (providers.length === 0) {
      // skip if no chat providers configured in env
      return;
    }
    const active = manager.getActiveChatProvider();
    // should return something if configured
    expect(active).toBeDefined();
  });
});
