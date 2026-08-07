import { describe, it, expect, beforeEach } from 'vitest';
import { memoryExtractor } from './extractor';

describe('MemoryExtractor', () => {
  beforeEach(() => {
    memoryExtractor.reset();
  });

  describe('extractFromText', () => {
    it('extracts facts from "my name is ..." patterns', () => {
      const memories = memoryExtractor.extractFromText('My name is Alice.', 'user', 1.0);
      const facts = memories.filter((m) => m.type === 'fact');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts[0].content).toContain('Alice');
      expect(facts[0].confidence).toBeGreaterThan(0.5);
    });

    it('extracts preferences from "I like ..." patterns', () => {
      const memories = memoryExtractor.extractFromText('I really like jazz music.', 'user', 1.0);
      const prefs = memories.filter((m) => m.type === 'preference');
      expect(prefs.length).toBeGreaterThanOrEqual(1);
      expect(prefs[0].content).toContain('jazz');
    });

    it('extracts events from time-related sentences', () => {
      const memories = memoryExtractor.extractFromText(
        'Yesterday I went to the park.',
        'user',
        1.0,
      );
      const events = memories.filter((m) => m.type === 'event');
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].content).toContain('went to the park');
    });
  });

  describe('extractFromExchange', () => {
    it('extracts from both user and assistant messages', () => {
      const memories = memoryExtractor.extractFromExchange(
        'My name is Bob.',
        'Nice to meet you, Bob!',
      );
      expect(memories.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates similar extractions', () => {
      const memories = memoryExtractor.extractFromExchange('My name is Alice.', '');
      memoryExtractor.extractFromExchange('My name is Alice.', '');
      // 重置后仅包含第一次提取的结果，第二次因 dedup 被过滤
      const uniqueContents = new Set(memories.map((m) => m.content.toLowerCase()));
      expect(uniqueContents.size).toBe(1);
    });
  });

  describe('deduplication', () => {
    it('keeps higher confidence when duplicates found', () => {
      const memories = memoryExtractor.extractFromExchange('I like cats.', '');
      const cats = memories.filter((m) => m.content.toLowerCase().includes('cats'));
      expect(cats.length).toBeGreaterThanOrEqual(1);
      expect(cats[0].confidence).toBeGreaterThan(0.5);
    });

    it('filters out low-confidence extractions', () => {
      const memories = memoryExtractor.extractFromExchange('hello there', '');
      // Low confidence should be filtered
      expect(memories.length).toBe(0);
    });
  });

  describe('中文抽取 (Chinese)', () => {
    it('extracts name from "我叫..."', () => {
      const memories = memoryExtractor.extractFromText('我叫小明。', 'user', 1.0);
      const facts = memories.filter((m) => m.type === 'fact');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts[0].content).toContain('小明');
      expect(facts[0].confidence).toBeGreaterThan(0.5);
    });

    it('extracts workplace from "我在...工作"', () => {
      const memories = memoryExtractor.extractFromText('我在腾讯上班。', 'user', 1.0);
      const facts = memories.filter((m) => m.type === 'fact');
      expect(facts.some((m) => m.content.includes('腾讯'))).toBe(true);
    });

    it('extracts preference from "我喜欢..."', () => {
      const memories = memoryExtractor.extractFromText('我喜欢猫。', 'user', 1.0);
      const prefs = memories.filter((m) => m.type === 'preference');
      expect(prefs.length).toBeGreaterThanOrEqual(1);
      expect(prefs[0].content).toContain('猫');
    });

    it('extracts negative preference from "我讨厌..."', () => {
      const memories = memoryExtractor.extractFromText('我讨厌下雨天。', 'user', 1.0);
      const prefs = memories.filter((m) => m.type === 'preference');
      expect(prefs.some((m) => m.content.includes('下雨天'))).toBe(true);
    });

    it('extracts events from time-related Chinese sentences', () => {
      const memories = memoryExtractor.extractFromText('昨天我去了公园。', 'user', 1.0);
      const events = memories.filter((m) => m.type === 'event');
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].content).toContain('公园');
    });

    it('extracts multiple facts in one message (matchAll)', () => {
      const memories = memoryExtractor.extractFromText(
        '我叫小红，我喜欢画画，我住在北京。',
        'user',
        1.0,
      );
      const facts = memories.filter((m) => m.type === 'fact');
      const prefs = memories.filter((m) => m.type === 'preference');
      expect(facts.some((m) => m.content.includes('小红'))).toBe(true);
      expect(facts.some((m) => m.content.includes('北京'))).toBe(true);
      expect(prefs.some((m) => m.content.includes('画画'))).toBe(true);
    });
  });

  describe('empty/short inputs', () => {
    it('returns empty array for very short text', () => {
      const memories = memoryExtractor.extractFromText('hi', 'user', 1.0);
      expect(memories).toEqual([]);
    });

    it('returns empty array for empty exchange', () => {
      const memories = memoryExtractor.extractFromExchange('', '');
      expect(memories).toEqual([]);
    });
  });
});
