import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIChatProvider } from './openai/chat';

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenAIChatProvider connectivity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns stream chunks when API responds SSE', async () => {
    const provider = new OpenAIChatProvider({
      id: 'test-openai',
      type: 'chat',
      name: 'Test OpenAI',
      enable: true,
      typeName: 'openai_chat',
      apiKey: 'test-key',
      apiBase: 'http://127.0.0.1:9877/v1',
      model: 'gpt-4o-mini',
    });

    const sse =
      'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"id":"2","choices":[{"delta":{"content":" World"}}]}\n\n' +
      'data: [DONE]\n\n';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const chunks: string[] = [];
    for await (const chunk of provider.chatStream({
      messages: [],
      temperature: 0.7,
      maxTokens: 1000,
    })) {
      if (chunk.type === 'text') {
        chunks.push(chunk.content);
      }
    }

    expect(chunks.join('')).toBe('Hello World');
  });

  it('surfaces API error in chatStream', async () => {
    const provider = new OpenAIChatProvider({
      id: 'test-openai',
      type: 'chat',
      name: 'Test OpenAI',
      enable: true,
      typeName: 'openai_chat',
      apiKey: 'bad',
      apiBase: 'http://127.0.0.1:9877/v1',
      model: 'gpt-4o-mini',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      ok({ error: { message: 'unauthorized' } }, 401),
    );

    const gen = provider.chatStream({ messages: [], temperature: 0.7, maxTokens: 1000 });
    await expect(gen.next()).rejects.toThrow('unauthorized');
  });
});
