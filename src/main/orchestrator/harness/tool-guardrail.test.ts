import { describe, it, expect } from "vitest";
import {
  normalizeToolArgs,
  makeToolSignature,
  classifyToolFailure,
  isIdempotentTool,
  ToolCallGuardrailController,
  DEFAULT_TOOL_GUARDRAIL_CONFIG,
} from "./tool-guardrail";

describe("tool-guardrail", () => {
  describe("normalizeToolArgs", () => {
    it("空参数返回空字符串", () => {
      expect(normalizeToolArgs({})).toBe("");
    });

    it("参数 key 排序，确保顺序无关", () => {
      const a = normalizeToolArgs({ a: 1, b: 2 });
      const b = normalizeToolArgs({ b: 2, a: 1 });
      expect(a).toBe(b);
      expect(a).toBe("a=1&b=2");
    });

    it("嵌套对象稳定序列化", () => {
      const a = normalizeToolArgs({ opts: { x: 1, y: 2 } });
      const b = normalizeToolArgs({ opts: { y: 2, x: 1 } });
      expect(a).toBe(b);
    });

    it("null/undefined 正确处理", () => {
      expect(normalizeToolArgs({ a: null, b: undefined })).toBe("a=null&b=undefined");
    });
  });

  describe("makeToolSignature", () => {
    it("生成工具名+参数签名", () => {
      const sig = makeToolSignature("read_file", { path: "/tmp/a.txt" });
      expect(sig.toolName).toBe("read_file");
      expect(sig.argsSignature).toBe("path=/tmp/a.txt");
    });
  });

  describe("classifyToolFailure", () => {
    it("outcome=failure 判定为失败", () => {
      expect(classifyToolFailure("failure")).toBe(true);
    });

    it("outcome=unknown 判定为失败", () => {
      expect(classifyToolFailure("unknown")).toBe(true);
    });

    it("outcome=success 且无错误关键词判定为成功", () => {
      expect(classifyToolFailure("success", "文件读取成功")).toBe(false);
    });

    it("输出包含 error: 判定为失败", () => {
      expect(classifyToolFailure("success", "Error: permission denied")).toBe(true);
    });

    it("输出包含 failed to 判定为失败", () => {
      expect(classifyToolFailure("success", "Failed to connect")).toBe(true);
    });

    it("输出包含 not found 判定为失败", () => {
      expect(classifyToolFailure("success", "File not found")).toBe(true);
    });

    it("无输出时只看 outcome", () => {
      expect(classifyToolFailure("success")).toBe(false);
      expect(classifyToolFailure("failure")).toBe(true);
    });
  });

  describe("isIdempotentTool", () => {
    it("read_only 为幂等", () => {
      expect(isIdempotentTool("read_only")).toBe(true);
    });

    it("idempotent_mutation 不为幂等（按 SideEffectKind 定义）", () => {
      expect(isIdempotentTool("idempotent_mutation")).toBe(false);
    });

    it("non_idempotent_side_effect 不为幂等", () => {
      expect(isIdempotentTool("non_idempotent_side_effect")).toBe(false);
    });
  });

  describe("ToolCallGuardrailController", () => {
    describe("基本流程", () => {
      it("初始状态 before_call 返回 allow", () => {
        const guard = new ToolCallGuardrailController();
        const decision = guard.beforeCall("read_file", { path: "/a.txt" }, "read_only");
        expect(decision.kind).toBe("allow");
      });

      it("默认配置阈值正确", () => {
        expect(DEFAULT_TOOL_GUARDRAIL_CONFIG.exactFailureBlockAfter).toBe(3);
        expect(DEFAULT_TOOL_GUARDRAIL_CONFIG.sameToolFailureHaltAfter).toBe(5);
        expect(DEFAULT_TOOL_GUARDRAIL_CONFIG.noProgressBlockAfter).toBe(3);
      });

      it("接受自定义配置", () => {
        const guard = new ToolCallGuardrailController({ exactFailureBlockAfter: 2 });
        // 失败2次后应 block
        guard.afterCall("t", {}, "read_only", true, "err");
        guard.afterCall("t", {}, "read_only", true, "err");
        const decision = guard.beforeCall("t", {}, "read_only");
        expect(decision.kind).toBe("block");
      });
    });

    describe("精确失败 block", () => {
      it("相同工具+相同参数失败3次后 block", () => {
        const guard = new ToolCallGuardrailController();
        const args = { path: "/a.txt" };

        // 前2次失败后仍 allow
        guard.afterCall("read_file", args, "read_only", true, "err");
        expect(guard.beforeCall("read_file", args, "read_only").kind).toBe("allow");
        guard.afterCall("read_file", args, "read_only", true, "err");
        expect(guard.beforeCall("read_file", args, "read_only").kind).toBe("warn");

        // 第3次失败后 block
        guard.afterCall("read_file", args, "read_only", true, "err");
        const decision = guard.beforeCall("read_file", args, "read_only");
        expect(decision.kind).toBe("block");
        expect(decision.reason).toContain("read_file");
        expect(decision.reason).toContain("3 次");
      });

      it("不同参数不触发精确失败 block", () => {
        const guard = new ToolCallGuardrailController();
        guard.afterCall("read_file", { path: "/a.txt" }, "read_only", true, "err");
        guard.afterCall("read_file", { path: "/a.txt" }, "read_only", true, "err");
        guard.afterCall("read_file", { path: "/a.txt" }, "read_only", true, "err");

        // 不同参数应 allow
        const decision = guard.beforeCall("read_file", { path: "/b.txt" }, "read_only");
        expect(decision.kind).not.toBe("block");
      });

      it("成功后清除精确失败记录", () => {
        const guard = new ToolCallGuardrailController();
        const args = { path: "/a.txt" };
        guard.afterCall("read_file", args, "read_only", true, "err");
        guard.afterCall("read_file", args, "read_only", true, "err");
        // 成功一次
        guard.afterCall("read_file", args, "read_only", false, "ok");
        // 再失败2次不应 block（因为成功清除了记录）
        guard.afterCall("read_file", args, "read_only", true, "err");
        guard.afterCall("read_file", args, "read_only", true, "err");
        const decision = guard.beforeCall("read_file", args, "read_only");
        expect(decision.kind).not.toBe("block");
      });
    });

    describe("同工具失败 halt", () => {
      it("同一工具（不同参数）失败5次后 halt", () => {
        const guard = new ToolCallGuardrailController();
        for (let i = 0; i < 5; i++) {
          guard.afterCall("run_shell", { cmd: `cmd${i}` }, "non_idempotent_side_effect", true, "err");
        }
        const decision = guard.beforeCall("run_shell", { cmd: "cmd6" }, "non_idempotent_side_effect");
        expect(decision.kind).toBe("halt");
        expect(decision.reason).toContain("5 次");
      });

      it("不同工具不触发同工具失败 halt", () => {
        const guard = new ToolCallGuardrailController();
        for (let i = 0; i < 5; i++) {
          guard.afterCall("tool_a", {}, "read_only", true, "err");
        }
        const decision = guard.beforeCall("tool_b", {}, "read_only");
        expect(decision.kind).not.toBe("halt");
      });
    });

    describe("幂等工具无进展 block", () => {
      it("只读工具相同参数返回相同结果3次后 block", () => {
        const guard = new ToolCallGuardrailController();
        const args = { query: "test" };
        guard.afterCall("search", args, "read_only", false, "result");
        guard.afterCall("search", args, "read_only", false, "result");
        // 第3次前应 warn
        expect(guard.beforeCall("search", args, "read_only").kind).toBe("warn");
        guard.afterCall("search", args, "read_only", false, "result");
        // 第4次前应 block
        const decision = guard.beforeCall("search", args, "read_only");
        expect(decision.kind).toBe("block");
        expect(decision.reason).toContain("无进展");
      });

      it("不同结果不触发无进展 block", () => {
        const guard = new ToolCallGuardrailController();
        const args = { query: "test" };
        guard.afterCall("search", args, "read_only", false, "result1");
        guard.afterCall("search", args, "read_only", false, "result2");
        guard.afterCall("search", args, "read_only", false, "result3");
        const decision = guard.beforeCall("search", args, "read_only");
        expect(decision.kind).not.toBe("block");
      });

      it("非幂等工具不检测无进展", () => {
        const guard = new ToolCallGuardrailController();
        const args = { cmd: "ls" };
        guard.afterCall("run_shell", args, "non_idempotent_side_effect", false, "same");
        guard.afterCall("run_shell", args, "non_idempotent_side_effect", false, "same");
        guard.afterCall("run_shell", args, "non_idempotent_side_effect", false, "same");
        const decision = guard.beforeCall("run_shell", args, "non_idempotent_side_effect");
        expect(decision.kind).not.toBe("block");
      });

      it("失败时清除无进展记录", () => {
        const guard = new ToolCallGuardrailController();
        const args = { query: "test" };
        guard.afterCall("search", args, "read_only", false, "result");
        guard.afterCall("search", args, "read_only", false, "result");
        // 失败一次
        guard.afterCall("search", args, "read_only", true, "err");
        // 再成功2次不应 block（失败清除了无进展记录）
        guard.afterCall("search", args, "read_only", false, "result");
        guard.afterCall("search", args, "read_only", false, "result");
        const decision = guard.beforeCall("search", args, "read_only");
        expect(decision.kind).not.toBe("block");
      });
    });

    describe("每轮重置", () => {
      it("resetForTurn 清除所有计数", () => {
        const guard = new ToolCallGuardrailController();
        guard.afterCall("t", {}, "read_only", true, "err");
        guard.afterCall("t", {}, "read_only", true, "err");
        guard.afterCall("t", {}, "read_only", true, "err");
        expect(guard.beforeCall("t", {}, "read_only").kind).toBe("block");

        guard.resetForTurn();
        expect(guard.beforeCall("t", {}, "read_only").kind).toBe("allow");
      });

      it("resetForTurn 清除 warn 去重", () => {
        const guard = new ToolCallGuardrailController();
        guard.afterCall("t", {}, "read_only", true, "err");
        guard.afterCall("t", {}, "read_only", true, "err");
        expect(guard.beforeCall("t", {}, "read_only").kind).toBe("warn");
        // 第二次 warn 应被去重为 allow
        expect(guard.beforeCall("t", {}, "read_only").kind).toBe("allow");

        guard.resetForTurn();
        guard.afterCall("t", {}, "read_only", true, "err");
        guard.afterCall("t", {}, "read_only", true, "err");
        // 重置后应再次 warn
        expect(guard.beforeCall("t", {}, "read_only").kind).toBe("warn");
      });
    });

    describe("warn 去重", () => {
      it("相同 key 的 warn 只发出一次", () => {
        const guard = new ToolCallGuardrailController();
        guard.afterCall("t", {}, "read_only", true, "err");
        guard.afterCall("t", {}, "read_only", true, "err");
        expect(guard.beforeCall("t", {}, "read_only").kind).toBe("warn");
        expect(guard.beforeCall("t", {}, "read_only").kind).toBe("allow");
      });
    });

    describe("snapshot", () => {
      it("返回诊断快照", () => {
        const guard = new ToolCallGuardrailController();
        guard.afterCall("t1", { a: 1 }, "read_only", true, "err");
        guard.afterCall("t2", {}, "read_only", true, "err");
        const snap = guard.snapshot();
        expect(Object.keys(snap.exactFailures).length).toBe(2);
        expect(snap.toolFailures["t1"]).toBe(1);
        expect(snap.toolFailures["t2"]).toBe(1);
      });
    });
  });
});
