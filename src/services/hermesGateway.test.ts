import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HermesGatewayClient } from './hermesGateway';

type MockWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
};

// ws / handleMessage 在 HermesGatewayClient 中是 private，直接交叉会得到 never，
// 故先 Omit 这两个私有成员，再补上测试用的桩实现。
type TestClient = Omit<HermesGatewayClient, 'ws' | 'handleMessage'> & {
  ws: MockWs;
  handleMessage: (msg: Record<string, unknown>) => void;
};

function createClient(): TestClient {
  const client = new HermesGatewayClient() as unknown as TestClient;
  client.ws = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
  };
  return client;
}

describe('HermesGatewayClient message routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes token/done/error by msgId when present', () => {
    const client = createClient();
    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const msgId = client.sendChat('hello', { onToken, onDone, onError });

    client.handleMessage({ type: 'token', token: 'a', id: msgId });
    expect(onToken).toHaveBeenCalledWith('a');

    client.handleMessage({ type: 'done', full_response: 'ok', id: msgId });
    expect(onDone).toHaveBeenCalledWith('ok');

    // The callback was removed after done, so a late error should not call it again.
    client.handleMessage({ type: 'error', message: 'boom', id: msgId });
    expect(onError).not.toHaveBeenCalled();
  });

  it('falls back to notify all pending callbacks when id is missing', () => {
    const client = createClient();
    const onDoneA = vi.fn();
    const onDoneB = vi.fn();
    client.sendChat('a', { onDone: onDoneA });
    client.sendChat('b', { onDone: onDoneB });

    client.handleMessage({ type: 'done', full_response: 'legacy' });

    expect(onDoneA).toHaveBeenCalledWith('legacy');
    expect(onDoneB).toHaveBeenCalledWith('legacy');
  });

  it('abort invokes onError on the targeted callback and preserves others', () => {
    const client = createClient();
    const onErrorA = vi.fn();
    const onErrorB = vi.fn();
    const idA = client.sendChat('a', { onError: onErrorA });
    client.sendChat('b', { onError: onErrorB });

    client.abort(idA);
    expect(onErrorA).toHaveBeenCalledWith('aborted');
    expect(onErrorB).not.toHaveBeenCalled();

    client.handleMessage({ type: 'error', message: 'y' });
    expect(onErrorB).toHaveBeenCalledWith('y');
  });
});
