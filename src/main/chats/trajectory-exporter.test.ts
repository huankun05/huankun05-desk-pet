import { describe, expect, it } from "vitest";
import {
  sanitizeText,
  messageToTrajectoryTurn,
  sessionToTrajectory,
  exportTrajectory,
  exportTrajectoryCompressed,
  collectTrajectorySessions,
  type TrajectoryTurn,
} from "./trajectory-exporter";
import type { ChatMessage, ChatSession, ChatSessionMeta } from "../../shared/chat-types";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello",
    at: 1700000000000,
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "Test Session",
    mode: "work",
    purpose: undefined,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    messages: [],
    messageCount: 0,
    ...overrides,
  };
}

describe("trajectory-exporter", () => {
  describe("sanitizeText", () => {
    it("redacts OpenAI-style API keys", () => {
      const text = "My key is sk-abc123def456ghi789jkl012mno345pqr";
      expect(sanitizeText(text)).toContain("sk-abc...5pqr");
      expect(sanitizeText(text)).not.toContain("sk-abc123");
    });

    it("redacts Bearer tokens", () => {
      const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      expect(sanitizeText(text)).toContain("Bearer eyJhbG...VCJ9");
    });

    it("redacts api_key=value", () => {
      expect(sanitizeText("api_key=my-secret-key-12345")).toContain("api_key=my-sec...2345");
      expect(sanitizeText('{"apiKey": "my-secret-key-12345"}')).toContain('"apiKey": "my-sec...2345"');
    });

    it("redacts password=value", () => {
      expect(sanitizeText("password=hunter2")).toContain("password=***");
    });

    it("leaves normal text untouched", () => {
      const text = "This is a normal message about programming.";
      expect(sanitizeText(text)).toBe(text);
    });

    it("handles empty string", () => {
      expect(sanitizeText("")).toBe("");
    });
  });

  describe("messageToTrajectoryTurn", () => {
    it("converts basic user message", () => {
      const session = makeSession();
      const message = makeMessage({ role: "user", content: "What is AI?" });
      const turn = messageToTrajectoryTurn(message, session, 0);
      expect(turn.session_id).toBe("session-1");
      expect(turn.session_title).toBe("Test Session");
      expect(turn.session_mode).toBe("work");
      expect(turn.turn_index).toBe(0);
      expect(turn.role).toBe("user");
      expect(turn.content).toBe("What is AI?");
      expect(turn.timestamp).toBe(1700000000000);
    });

    it("includes reasoning for assistant messages", () => {
      const session = makeSession();
      const message = makeMessage({ role: "assistant", content: "AI is...", reasoning: "Let me think..." });
      const turn = messageToTrajectoryTurn(message, session, 1);
      expect(turn.reasoning).toBe("Let me think...");
    });

    it("sanitizes content by default", () => {
      const session = makeSession();
      const message = makeMessage({ content: "My key is sk-abc123def456ghi789jkl012mno345pqr" });
      const turn = messageToTrajectoryTurn(message, session, 0);
      expect(turn.content).toContain("sk-abc...5pqr");
    });

    it("skips sanitization when sanitize=false", () => {
      const session = makeSession();
      const message = makeMessage({ content: "My key is sk-abc123def456ghi789jkl012mno345pqr" });
      const turn = messageToTrajectoryTurn(message, session, 0, false);
      expect(turn.content).toContain("sk-abc123");
    });

    it("includes tool executions", () => {
      const session = makeSession();
      const message = makeMessage({
        role: "assistant",
        content: "Let me check the weather.",
        toolExecutions: [
          {
            id: "call-1",
            name: "get_weather",
            argsText: JSON.stringify({ city: "Beijing" }),
            result: JSON.stringify({ temp: 25 }),
            status: "success",
          } as never,
        ],
      });
      const turn = messageToTrajectoryTurn(message, session, 0);
      expect(turn.tool_calls).toHaveLength(1);
      expect(turn.tool_calls?.[0].name).toBe("get_weather");
      expect(turn.tool_results).toHaveLength(1);
      expect(turn.tool_results?.[0].is_error).toBe(false);
    });
  });

  describe("sessionToTrajectory", () => {
    it("converts all messages in session", () => {
      const session = makeSession({
        messages: [
          makeMessage({ id: "m1", role: "user", content: "Hi", at: 1000 }),
          makeMessage({ id: "m2", role: "assistant", content: "Hello!", at: 2000 }),
        ],
      });
      const turns = sessionToTrajectory(session);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe("user");
      expect(turns[1].role).toBe("assistant");
      expect(turns[0].turn_index).toBe(0);
      expect(turns[1].turn_index).toBe(1);
    });

    it("filters by since timestamp", () => {
      const session = makeSession({
        messages: [
          makeMessage({ id: "m1", at: 1000 }),
          makeMessage({ id: "m2", at: 2000 }),
          makeMessage({ id: "m3", at: 3000 }),
        ],
      });
      const turns = sessionToTrajectory(session, { since: 1500 });
      expect(turns).toHaveLength(2);
      expect(turns[0].timestamp).toBe(2000);
    });

    it("filters by until timestamp", () => {
      const session = makeSession({
        messages: [
          makeMessage({ id: "m1", at: 1000 }),
          makeMessage({ id: "m2", at: 2000 }),
          makeMessage({ id: "m3", at: 3000 }),
        ],
      });
      const turns = sessionToTrajectory(session, { until: 2500 });
      expect(turns).toHaveLength(2);
      expect(turns[1].timestamp).toBe(2000);
    });
  });

  describe("exportTrajectory", () => {
    const meta1: ChatSessionMeta = {
      id: "s1",
      title: "Session 1",
      mode: "work",
      createdAt: 1000,
      updatedAt: 2000,
      messageCount: 2,
    };
    const meta2: ChatSessionMeta = {
      id: "s2",
      title: "Session 2",
      mode: "chat",
      createdAt: 3000,
      updatedAt: 4000,
      messageCount: 1,
    };

    const sessions = [meta1, meta2];
    const getSession = (id: string): ChatSession | null => {
      if (id === "s1") return makeSession({ id: "s1", title: "Session 1", mode: "work", messages: [makeMessage({ id: "m1", content: "Hello" }), makeMessage({ id: "m2", role: "assistant", content: "Hi" })] });
      if (id === "s2") return makeSession({ id: "s2", title: "Session 2", mode: "chat", messages: [makeMessage({ id: "m3", content: "Chat" })] });
      return null;
    };

    it("exports all sessions by default", () => {
      const result = exportTrajectory(sessions, getSession);
      expect(result.sessionCount).toBe(2);
      expect(result.turnCount).toBe(3);
      expect(result.turns).toHaveLength(3);
    });

    it("filters by sessionId", () => {
      const result = exportTrajectory(sessions, getSession, { sessionId: "s1" });
      expect(result.sessionCount).toBe(1);
      expect(result.turnCount).toBe(2);
    });

    it("filters by mode", () => {
      const result = exportTrajectory(sessions, getSession, { mode: "chat" });
      expect(result.sessionCount).toBe(1);
      expect(result.turnCount).toBe(1);
    });

    it("writes to file when outputPath is specified", () => {
      const tmpDir = require("node:os").tmpdir();
      const outputPath = require("node:path").join(tmpDir, `trajectory-test-${Date.now()}.jsonl`);
      try {
        const result = exportTrajectory(sessions, getSession, { outputPath });
        expect(result.outputPath).toBe(outputPath);
        expect(result.turnCount).toBe(3);
        expect(result.turns).toBeUndefined();

        const fs = require("node:fs");
        const content = fs.readFileSync(outputPath, "utf8");
        const lines = content.trim().split("\n");
        expect(lines).toHaveLength(3);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.session_id).toBe("s1");
        expect(parsed.role).toBe("user");
      } finally {
        require("node:fs").unlinkSync(outputPath);
      }
    });

    it("returns empty result when no sessions match", () => {
      const result = exportTrajectory(sessions, getSession, { sessionId: "nonexistent" });
      expect(result.sessionCount).toBe(0);
      expect(result.turnCount).toBe(0);
      expect(result.turns).toEqual([]);
    });
  });

  describe("collectTrajectorySessions", () => {
    const meta1: ChatSessionMeta = { id: "s1", title: "S1", mode: "work", createdAt: 1000, updatedAt: 2000, messageCount: 2 };
    const meta2: ChatSessionMeta = { id: "s2", title: "S2", mode: "chat", createdAt: 3000, updatedAt: 4000, messageCount: 1 };
    const getSession = (id: string): ChatSession | null => {
      if (id === "s1") return makeSession({ id: "s1", messages: [makeMessage({ id: "m1", content: "Hello" }), makeMessage({ id: "m2", role: "assistant", content: "Hi" })] });
      if (id === "s2") return makeSession({ id: "s2", messages: [makeMessage({ id: "m3", content: "Chat" })] });
      return null;
    };

    it("按会话分组返回 turns", () => {
      const { grouped, sessionCount } = collectTrajectorySessions([meta1, meta2], getSession);
      expect(sessionCount).toBe(2);
      expect(grouped).toHaveLength(2);
      expect(grouped[0]).toHaveLength(2);
      expect(grouped[1]).toHaveLength(1);
    });

    it("过滤后仍按会话分组", () => {
      const { grouped, sessionCount } = collectTrajectorySessions([meta1, meta2], getSession, { mode: "work" });
      expect(sessionCount).toBe(1);
      expect(grouped).toHaveLength(1);
      expect(grouped[0][0].session_id).toBe("s1");
    });
  });

  describe("exportTrajectoryCompressed", () => {
    // 构造一个超过目标预算的大会话：30 轮交替 assistant/tool
    function makeBigSession(): ChatSession {
      const messages = Array.from({ length: 30 }, (_, i) =>
        makeMessage({
          id: `m${i}`,
          role: i % 2 === 0 ? "assistant" : "tool",
          content: "content ".repeat(300),
          at: 1000 + i,
        }),
      );
      return makeSession({ id: "big", title: "Big", mode: "work", messages });
    }

    const summarize = async (): Promise<string> => "[CONTEXT SUMMARY]: middle turns compressed.";

    it("压缩每个会话并返回压缩 turns 与汇总指标", async () => {
      const meta: ChatSessionMeta = { id: "big", title: "Big", mode: "work", createdAt: 1000, updatedAt: 1000, messageCount: 30 };
      const result = await exportTrajectoryCompressed([meta], (id) => (id === "big" ? makeBigSession() : null), {
        compression: { summarize, config: { targetMaxTokens: 4000 } },
      });
      expect(result.sessionCount).toBe(1);
      expect(result.turnCount).toBeLessThan(30);
      expect(result.turns?.some((t) => t.role === "user" && t.content.startsWith("[CONTEXT SUMMARY]:"))).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(result.metrics!.summary.total_trajectories).toBe(1);
      expect(result.metrics!.summary.trajectories_compressed).toBe(1);
    });

    it("无注入摘要函数时压缩仍可用（占位摘要）", async () => {
      const meta: ChatSessionMeta = { id: "big", title: "Big", mode: "work", createdAt: 1000, updatedAt: 1000, messageCount: 30 };
      const result = await exportTrajectoryCompressed([meta], (id) => (id === "big" ? makeBigSession() : null), {
        compression: { config: { targetMaxTokens: 4000 } },
      });
      expect(result.turns?.some((t) => t.content.startsWith("[CONTEXT SUMMARY]: [Summary generation unavailable"))).toBe(true);
    });

    it("低预算会话跳过压缩并计入 skipped", async () => {
      const meta1: ChatSessionMeta = { id: "s1", title: "S1", mode: "chat", createdAt: 1000, updatedAt: 2000, messageCount: 1 };
      const result = await exportTrajectoryCompressed(
        [meta1],
        (id) => (id === "s1" ? makeSession({ id: "s1", messages: [makeMessage({ id: "m1", content: "hi" })] }) : null),
        { compression: { summarize, config: { targetMaxTokens: 4000 } } },
      );
      expect(result.sessionCount).toBe(1);
      expect(result.turnCount).toBe(1);
      expect(result.metrics!.summary.trajectories_skipped_under_target).toBe(1);
    });

    it("写出到文件", async () => {
      const meta: ChatSessionMeta = { id: "big", title: "Big", mode: "work", createdAt: 1000, updatedAt: 1000, messageCount: 30 };
      const tmpDir = require("node:os").tmpdir();
      const outputPath = require("node:path").join(tmpDir, `trajectory-compressed-test-${Date.now()}.jsonl`);
      try {
        const result = await exportTrajectoryCompressed([meta], (id) => (id === "big" ? makeBigSession() : null), {
          outputPath,
          compression: { summarize, config: { targetMaxTokens: 4000 } },
        });
        expect(result.outputPath).toBe(outputPath);
        expect(result.turns).toBeUndefined();
        const fs = require("node:fs");
        const lines = fs.readFileSync(outputPath, "utf8").trim().split("\n");
        expect(lines.length).toBe(result.turnCount);
        expect(JSON.parse(lines[0]).role).toBe("assistant");
      } finally {
        require("node:fs").unlinkSync(outputPath);
      }
    });

    it("无匹配会话返回空结果", async () => {
      const result = await exportTrajectoryCompressed([], () => null, { compression: { summarize } });
      expect(result.sessionCount).toBe(0);
      expect(result.turnCount).toBe(0);
      expect(result.turns).toEqual([]);
    });
  });
});
