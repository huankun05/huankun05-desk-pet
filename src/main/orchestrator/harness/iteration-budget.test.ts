import { describe, it, expect } from "vitest";
import {
  IterationBudget,
  DEFAULT_PARENT_ITERATIONS,
  DEFAULT_SUBAGENT_ITERATIONS,
} from "./iteration-budget";

describe("IterationBudget", () => {
  describe("构造", () => {
    it("默认使用父 agent 迭代上限 90", () => {
      const budget = new IterationBudget();
      expect(budget.maxTotal).toBe(DEFAULT_PARENT_ITERATIONS);
      expect(budget.used).toBe(0);
      expect(budget.remaining).toBe(90);
    });

    it("接受自定义上限", () => {
      const budget = new IterationBudget(50);
      expect(budget.maxTotal).toBe(50);
      expect(budget.remaining).toBe(50);
    });

    it("子 agent 默认上限为 50", () => {
      expect(DEFAULT_SUBAGENT_ITERATIONS).toBe(50);
    });

    it("非正整数上限抛错", () => {
      expect(() => new IterationBudget(0)).toThrow();
      expect(() => new IterationBudget(-1)).toThrow();
      expect(() => new IterationBudget(NaN)).toThrow();
    });

    it("浮点上限向下取整", () => {
      const budget = new IterationBudget(10.9);
      expect(budget.maxTotal).toBe(10);
    });
  });

  describe("consume", () => {
    it("预算内 consume 返回 true 并递增 used", () => {
      const budget = new IterationBudget(3);
      expect(budget.consume()).toBe(true);
      expect(budget.used).toBe(1);
      expect(budget.remaining).toBe(2);
    });

    it("耗尽后 consume 返回 false", () => {
      const budget = new IterationBudget(2);
      expect(budget.consume()).toBe(true);
      expect(budget.consume()).toBe(true);
      expect(budget.consume()).toBe(false);
      expect(budget.used).toBe(2);
    });

    it("耗尽后 exhausted 为 true", () => {
      const budget = new IterationBudget(1);
      expect(budget.exhausted).toBe(false);
      budget.consume();
      expect(budget.exhausted).toBe(true);
    });
  });

  describe("refund", () => {
    it("成功后 refund 递减 used", () => {
      const budget = new IterationBudget(3);
      budget.consume();
      budget.consume();
      expect(budget.used).toBe(2);
      budget.refund();
      expect(budget.used).toBe(1);
      expect(budget.remaining).toBe(2);
    });

    it("refund 不会让 used 低于 0", () => {
      const budget = new IterationBudget(3);
      expect(budget.used).toBe(0);
      budget.refund();
      expect(budget.used).toBe(0);
    });

    it("refund 后可以重新 consume", () => {
      const budget = new IterationBudget(1);
      expect(budget.consume()).toBe(true);
      expect(budget.consume()).toBe(false);
      budget.refund();
      expect(budget.consume()).toBe(true);
    });
  });

  describe("snapshot", () => {
    it("返回当前预算快照", () => {
      const budget = new IterationBudget(10);
      budget.consume();
      budget.consume();
      const snap = budget.snapshot();
      expect(snap).toEqual({ used: 2, remaining: 8, maxTotal: 10 });
    });
  });

  describe("与 Hermes 行为对齐", () => {
    it("模拟 Hermes 主循环：consume 每次模型调用，程序化工具成功后 refund", () => {
      const budget = new IterationBudget(5);
      // 第 1 次模型调用 → 调用 run_verification 成功 → refund
      expect(budget.consume()).toBe(true);
      budget.refund();
      expect(budget.used).toBe(0);

      // 第 2 次模型调用 → 普通工具，不 refund
      expect(budget.consume()).toBe(true);
      expect(budget.used).toBe(1);

      // 继续消耗直到耗尽
      for (let i = 0; i < 4; i++) budget.consume();
      expect(budget.consume()).toBe(false);
      expect(budget.used).toBe(5);
    });
  });
});
