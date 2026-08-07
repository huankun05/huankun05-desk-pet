/**
 * Embedding index for hybrid retrieval.
 *
 * This is a minimal vector index used only to fuse BM25 scores with
 * embedding similarity scores in the RAG engine.
 */

export interface VectorDoc {
  id: string;
  vec: number[];
}

export class EmbeddingIndex {
  private docs = new Map<string, VectorDoc>();

  upsert(id: string, vec: number[]): void {
    this.docs.set(id, { id, vec });
  }

  remove(id: string): void {
    this.docs.delete(id);
  }

  clear(): void {
    this.docs.clear();
  }

  get size(): number {
    return this.docs.size;
  }

  cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    if (denom === 0) return 0;
    return dot / denom;
  }

  search(queryVec: number[], docIds: string[], topK = 20): Map<string, number> {
    const scores = new Map<string, number>();
    if (!queryVec.length) return scores;

    for (const id of docIds) {
      const doc = this.docs.get(id);
      if (!doc) continue;
      const score = this.cosine(queryVec, doc.vec);
      if (score > 0) scores.set(id, score);
    }

    const entries = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
    return new Map(entries);
  }
}
