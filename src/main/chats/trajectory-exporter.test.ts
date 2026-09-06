import { describe, expect, it } from "vitest";
import {
  sanitizeText,
  messageToTrajectoryTurn,
  sessionToTrajectory,
  exportTrajectory,
  exportTrajectoryCompressed,
  collectTrajectorySessions,
  convertTurnsToFormat,
  writeExportLines,
  shouldCompressOutput,
  loadExportCursor,
  saveExportCursor,
  defaultCursorPath,
  type TrajectoryTurn,
} from "./trajectory-exporter";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as os from "node:os";
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

  describe("convertTurnsToFormat", () => {
    const turns: TrajectoryTurn[] = [
      {
        session_id: "s1",
        session_title: "S1",
        session_mode: "work",
        turn_index: 0,
        role: "user",
        content: "Hello",
        timestamp: 1000,
      },
      {
        session_id: "s1",
        session_title: "S1",
        session_mode: "work",
        turn_index: 1,
        role: "assistant",
        content: "Checking...",
        tool_calls: [{ id: "call-1", name: "get_weather", arguments: '{"city":"Beijing"}' }],
        timestamp: 2000,
      },
      {
        session_id: "s1",
        session_title: "S1",
        session_mode: "work",
        turn_index: 2,
        role: "tool",
        content: "25C",
        timestamp: 3000,
      },
    ];

    it("openai 格式：messages 数组 + 函数调用结构", () => {
      const obj = convertTurnsToFormat(turns, "openai");
      expect((obj.messages as unknown[])).toHaveLength(3);
      const messages = obj.messages as Array<Record<string, unknown>>;
      expect(messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].tool_calls).toEqual([
        { id: "call-1", type: "function", function: { name: "get_weather", arguments: '{"city":"Beijing"}' } },
      ]);
      expect(messages[2]).toEqual({ role: "tool", content: "25C" });
    });

    it("sharegpt 格式：conversations 数组 with from/value", () => {
      const obj = convertTurnsToFormat(turns, "sharegpt");
      const conv = obj.conversations as Array<{ from: string; value: string }>;
      expect(conv).toHaveLength(3);
      expect(conv[0]).toEqual({ from: "human", value: "Hello" });
      expect(conv[1]).toEqual({ from: "gpt", value: "Checking..." });
      expect(conv[2]).toEqual({ from: "human", value: "25C" });
    });

    it("cyrene 格式回退为 turns 包装", () => {
      const obj = convertTurnsToFormat(turns, "cyrene");
      expect(obj.turns).toBe(turns);
    });
  });

  describe("writeExportLines / shouldCompressOutput", () => {
    it(".gz 扩展名自动启用 gzip，内容可解压回原文", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-gz-"));
      const outputPath = path.join(dir, "traj.jsonl.gz");
      try {
        writeExportLines(outputPath, ["a", "b", "c"]);
        expect(shouldCompressOutput(outputPath)).toBe(true);
        const raw = fs.readFileSync(outputPath);
        // gzip 魔数
        expect(raw[0]).toBe(0x1f);
        expect(raw[1]).toBe(0x8b);
        const decompressed = zlib.gunzipSync(raw).toString("utf8");
        expect(decompressed).toBe("a\nb\nc\n");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("compress=true 强制 gzip（非 .gz 路径）", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-gz2-"));
      const outputPath = path.join(dir, "traj.jsonl");
      try {
        writeExportLines(outputPath, ["x"], { compress: true });
        expect(shouldCompressOutput(outputPath, { compress: true })).toBe(true);
        const raw = fs.readFileSync(outputPath);
        expect(zlib.gunzipSync(raw).toString("utf8")).toBe("x\n");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("默认明文写入", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-plain-"));
      const outputPath = path.join(dir, "traj.jsonl");
      try {
        writeExportLines(outputPath, ["y"]);
        expect(fs.readFileSync(outputPath, "utf8")).toBe("y\n");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("增量导出（incremental）", () => {
    it("第一次全量导出并落盘游标，第二次只导出新消息", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-inc-"));
      const outputPath = path.join(dir, "traj.jsonl");
      const cursorPath = defaultCursorPath(outputPath);

      const makeMeta = (messages: ChatMessage[]): ChatSessionMeta =>
        ({ id: "s1", title: "S1", mode: "work", createdAt: 1000, updatedAt: messages[messages.length - 1].at, messageCount: messages.length });
      const messagesV1 = [
        makeMessage({ id: "m1", content: "first", at: 1000 }),
        makeMessage({ id: "m2", role: "assistant", content: "reply", at: 2000 }),
      ];
      const messagesV2 = [
        ...messagesV1,
        makeMessage({ id: "m3", content: "new message", at: 3000 }),
      ];

      try {
        // 第一次导出（当前状态 v1）
        let result = exportTrajectory([makeMeta(messagesV1)], (id) =>
          (id === "s1" ? makeSession({ id: "s1", messages: messagesV1 }) : null),
          { outputPath, incremental: true });
        expect(result.incremental).toBe(true);
        expect(result.turnCount).toBe(2);
        expect(result.cursor).toEqual({ s1: 2000 });
        // 游标文件已落盘
        expect(loadExportCursor(cursorPath)).toEqual({ s1: 2000 });

        // 会话追加新消息（v2），第二次导出只应包含新消息
        result = exportTrajectory([makeMeta(messagesV2)], (id) =>
          (id === "s1" ? makeSession({ id: "s1", messages: messagesV2 }) : null),
          { outputPath, incremental: true });
        expect(result.turnCount).toBe(1);
        expect(result.cursor).toEqual({ s1: 3000 });

        // 输出文件内容：只含新消息
        const content = fs.readFileSync(outputPath, "utf8").trim();
        expect(JSON.parse(content).id ?? JSON.parse(content).content).toBe("new message");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("无 outputPath 时增量导出降级为全量（不写游标）", () => {
      const meta: ChatSessionMeta = { id: "s1", title: "S1", mode: "work", createdAt: 1000, updatedAt: 1000, messageCount: 1 };
      const result = exportTrajectory(
        [meta],
        (id) => (id === "s1" ? makeSession({ id: "s1", messages: [makeMessage({ id: "m1", content: "hi", at: 1000 })] }) : null),
        { incremental: true },
      );
      expect(result.turnCount).toBe(1);
      expect(result.incremental).toBeUndefined();
      expect(result.cursor).toBeUndefined();
    });

    it("损坏游标文件降级为全量导出", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-inc-bad-"));
      const outputPath = path.join(dir, "traj.jsonl");
      const cursorPath = defaultCursorPath(outputPath);
      try {
        fs.writeFileSync(cursorPath, "not-json", "utf8");
        const meta: ChatSessionMeta = { id: "s1", title: "S1", mode: "work", createdAt: 1000, updatedAt: 1000, messageCount: 1 };
        const result = exportTrajectory(
          [meta],
          (id) => (id === "s1" ? makeSession({ id: "s1", messages: [makeMessage({ id: "m1", content: "hi", at: 1000 })] }) : null),
          { outputPath, incremental: true },
        );
        expect(result.turnCount).toBe(1);
        // 损坏游标被重写为有效游标
        expect(loadExportCursor(cursorPath)).toEqual({ s1: 1000 });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("saveExportCursor 原子写可读回", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-cursor-"));
      const cursorPath = path.join(dir, "cursor.json");
      try {
        saveExportCursor(cursorPath, { s1: 100, s2: 200 });
        expect(loadExportCursor(cursorPath)).toEqual({ s1: 100, s2: 200 });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("exportTrajectory format 写出", () => {
    it("openai 格式写出：每会话一行 messages 数组", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-fmt-"));
      const outputPath = path.join(dir, "openai.jsonl");
      const meta: ChatSessionMeta = { id: "s1", title: "S1", mode: "work", createdAt: 1000, updatedAt: 2000, messageCount: 2 };
      try {
        const result = exportTrajectory(
          [meta],
          (id) => (id === "s1" ? makeSession({ id: "s1", messages: [makeMessage({ id: "m1", content: "hi", at: 1000 }), makeMessage({ id: "m2", role: "assistant", content: "yo", at: 2000 })] }) : null),
          { outputPath, format: "openai" },
        );
        expect(result.turnCount).toBe(2);
        expect(result.sessionCount).toBe(1);
        const lines = fs.readFileSync(outputPath, "utf8").trim().split("\n");
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.messages).toHaveLength(2);
        expect(parsed.messages[0].role).toBe("user");
        expect(parsed.messages[1].role).toBe("assistant");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
