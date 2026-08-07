import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessagesTokens,
  getTokenUsageRate,
  isOverThreshold,
} from './tokenEstimator';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates Chinese characters at 0.6 token each', () => {
    // 11 Chinese chars → ceil(11 * 0.6) = ceil(6.6) = 7
    expect(estimateTokens('你好世界测试中文十个字')).toBe(7);
  });

  it('estimates ASCII at 0.3 token each', () => {
    // 10 ASCII chars → ceil(10 * 0.3) = 3
    expect(estimateTokens('helloworld')).toBe(3);
  });

  it('mixed Chinese and English', () => {
    // "你好hello" → 2 Chinese (1.2) + 5 ASCII (1.5) = 2.7 → ceil = 3
    expect(estimateTokens('你好hello')).toBe(3);
  });

  it('handles single character', () => {
    expect(estimateTokens('中')).toBe(1); // ceil(0.6)
    expect(estimateTokens('a')).toBe(1); // ceil(0.3)
  });

  it('large text estimation', () => {
    const long = '这是一段很长的中文文本用于测试token估算功能看看效果如何';
    // 25 Chinese (0.6=15.0) + 5 ASCII (0.3=1.5) = 16.5 → ceil = 17
    expect(estimateTokens(long)).toBe(17);
  });
});

describe('estimateMessagesTokens', () => {
  it('returns zero for empty array', () => {
    const result = estimateMessagesTokens([]);
    expect(result.tokens).toBe(0);
    expect(result.chars).toBe(0);
  });

  it('accounts for role overhead (~4 tokens per message)', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const result = estimateMessagesTokens(messages);
    // Tokens: ceil(5*0.3)=2 + ceil(2*0.3)=1 + 2*4(overhead) = 2+1+8 = 11
    // Chars: 5+2 = 7
    expect(result.tokens).toBeGreaterThanOrEqual(10);
    expect(result.chars).toBe(7);
  });

  it('multi-turn conversation', () => {
    const messages = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮助你的吗？' },
      { role: 'user', content: '今天天气如何' },
    ];
    const result = estimateMessagesTokens(messages);
    // 3 messages, total overhead = 12
    expect(result.tokens).toBeGreaterThan(12);
  });
});

describe('getTokenUsageRate', () => {
  it('returns 0 when maxTokens is 0', () => {
    expect(getTokenUsageRate(100, 0)).toBe(0);
  });

  it('calculates correct rate', () => {
    expect(getTokenUsageRate(500, 1000)).toBe(0.5);
    expect(getTokenUsageRate(800, 1000)).toBe(0.8);
  });

  it('returns 1 for full usage', () => {
    expect(getTokenUsageRate(1000, 1000)).toBe(1);
  });
});

describe('isOverThreshold', () => {
  it('default threshold is 0.82', () => {
    expect(isOverThreshold(800, 1000)).toBe(false); // 0.8
    expect(isOverThreshold(830, 1000)).toBe(true); // 0.83
  });

  it('custom threshold', () => {
    expect(isOverThreshold(600, 1000, 0.5)).toBe(true); // 0.6 > 0.5
    expect(isOverThreshold(400, 1000, 0.5)).toBe(false); // 0.4 < 0.5
  });
});
