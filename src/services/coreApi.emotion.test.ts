import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  postEmotionBridgeEvent,
  getEmotionBridgeState,
  getEmotionBridgeConfig,
} from '../services/coreApi';

const OK_BODY = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('coreApi emotion bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('postEmotionBridgeEvent sends event/value to API', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(OK_BODY({ applied: true }));

    const result = await postEmotionBridgeEvent('interaction:pat', undefined);

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe('interaction:pat');
    expect(result.applied).toBe(true);
  });

  it('getEmotionBridgeState reads state from API', async () => {
    const state = {
      dimensions: { pleasure: 60 },
      pad: { pleasure: 0.2, arousal: 0.1, dominance: 0.0 },
      mood_label: 'happy',
      expression_scale: 0.6,
      recent_history: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(OK_BODY(state));

    const result = await getEmotionBridgeState();
    expect(result.mood_label).toBe('happy');
    expect(result.pad.pleasure).toBeCloseTo(0.2);
  });

  it('getEmotionBridgeConfig reads config from API', async () => {
    const cfg = { throttle_ms: 5000, weights: { interaction: 0.3 } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(OK_BODY(cfg));

    const result = await getEmotionBridgeConfig();
    expect(result.throttle_ms).toBe(5000);
  });
});
