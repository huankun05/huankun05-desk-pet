import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EdgeTTSProvider } from './tts/edge';

describe('EdgeTTSProvider connectivity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports API availability via validate when endpoint is healthy', async () => {
    const provider = new EdgeTTSProvider({
      id: 'test-edge',
      type: 'tts',
      name: 'Test Edge',
      enable: true,
      typeName: 'edge_tts',
      apiBase: 'http://localhost:8001',
      voice: 'zh-CN-XiaoxiaoNeural',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ voices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await provider.validate();
    expect(result).toBe(true);
  });

  it('throws when Edge TTS endpoint is unreachable', async () => {
    const provider = new EdgeTTSProvider({
      id: 'test-edge',
      type: 'tts',
      name: 'Test Edge',
      enable: true,
      typeName: 'edge_tts',
      apiBase: 'http://localhost:8001',
      voice: 'zh-CN-XiaoxiaoNeural',
    });

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(provider.validate()).rejects.toThrow('网络错误');
  });
});
