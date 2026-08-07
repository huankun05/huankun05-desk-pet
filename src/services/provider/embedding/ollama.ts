/**
 * OllamaEmbeddingProvider — 本地/兼容 OpenAI 的 Embedding 适配器
 *
 * 优先使用 Ollama 原生 embedding 接口；也可回退到 OpenAI 兼容接口。
 */

import type { EmbeddingProvider, EmbeddingProviderConfig, Provider } from '../types';

const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';

export class OllamaEmbeddingProvider implements EmbeddingProvider, Provider {
  readonly config: EmbeddingProviderConfig;

  constructor(config: EmbeddingProviderConfig) {
    this.config = {
      ...config,
      apiBase: (config.apiBase || OLLAMA_DEFAULT_HOST).replace(/\/+$/, ''),
      model: config.model || 'nomic-embed-text',
    };
  }

  getName(): string {
    return this.config.name || 'Ollama Embedding';
  }

  getType(): 'embedding' {
    return 'embedding';
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.apiBase}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const names = (data.models || []).map((m) => m.name);
      return names.some((n) => n.includes(this.config.model || 'nomic-embed-text'));
    } catch {
      return false;
    }
  }

  async getEmbedding(texts: string[]): Promise<number[][]> {
    const base = this.config.apiBase || OLLAMA_DEFAULT_HOST;
    const results: number[][] = [];

    for (const text of texts) {
      const res = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, prompt: text }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        throw new Error(`Embedding failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { embedding: number[] };
      results.push(data.embedding);
    }

    return results;
  }

  getDim(): number {
    // nomic-embed-text 默认 768 维；若模型未知返回 0，调用方需兼容
    return this.config.model?.includes('nomic-embed-text') ? 768 : 0;
  }

  abort(): void {
    // Ollama embedding 请求为一次性 fetch，不支持外部 abort
  }
}
