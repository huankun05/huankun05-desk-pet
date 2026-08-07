import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HermesGatewayClient } from './hermesGateway';

function createClient() {
  const client = new HermesGatewayClient();
  (client as any).ws = {
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

    (client as any).handleMessage({ type: 'token', token: 'a', id: msgId });
    expect(onToken).toHaveBeenCalledWith('a');

    (client as any).handleMessage({ type: 'done', full_response: 'ok', id: msgId });
    expect(onDone).toHaveBeenCalledWith('ok');

    // The callback was removed after done, so a late error should not call it again.
    (client as any).handleMessage({ type: 'error', message: 'boom', id: msgId });
    expect(onError).not.toHaveBeenCalled();
  });

  it('falls back to notify all pending callbacks when id is missing', () => {
    const client = createClient();
    const onDoneA = vi.fn();
    const onDoneB = vi.fn();
    client.sendChat('a', { onDone: onDoneA });
    client.sendChat('b', { onDone: onDoneB });

    (client as any).handleMessage({ type: 'done', full_response: 'legacy' });

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

    (client as any).handleMessage({ type: 'error', message: 'y' });
    expect(onErrorB).toHaveBeenCalledWith('y');
  });
});
