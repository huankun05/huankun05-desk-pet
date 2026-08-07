/**
 * OpenAIEmbeddingProvider — OpenAI 兼容 Embedding 适配器
 *
 * 适用于 OpenAI、Azure、DeepSeek、StepFun 等兼容接口。
 */

import type { EmbeddingProvider, EmbeddingProviderConfig, Provider } from '../types';

export class OpenAIEmbeddingProvider implements EmbeddingProvider, Provider {
  readonly config: EmbeddingProviderConfig;

  constructor(config: EmbeddingProviderConfig) {
    this.config = {
      ...config,
      apiBase: (config.apiBase || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: config.model || 'text-embedding-3-small',
    };
  }

  getName(): string {
    return this.config.name || 'OpenAI Embedding';
  }

  getType(): 'embedding' {
    return 'embedding';
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.apiBase}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getEmbedding(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const base = this.config.apiBase || 'https://api.openai.com/v1';

    for (const text of texts) {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, input: text }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        throw new Error(`Embedding failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      const embedding = data.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error('Embedding response missing embedding');
      }
      results.push(embedding);
    }

    return results;
  }

  getDim(): number {
    const model = this.config.model || 'text-embedding-3-small';
    if (model.includes('text-embedding-3-large')) return 3072;
    if (model.includes('text-embedding-3-small')) return 1536;
    if (model.includes('text-embedding-ada-002')) return 1536;
    return 0;
  }

  abort(): void {
    // OpenAI embedding 请求为一次性 fetch，暂不支持外部 abort
  }
}
