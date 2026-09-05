import { describe, expect, it } from "vitest";
import {
  sanitizeText,
  messageToTrajectoryTurn,
  sessionToTrajectory,
  exportTrajectory,
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
      expect(sanitizeText(text)).toContain("[REDACTED_API_KEY]");
      expect(sanitizeText(text)).not.toContain("sk-abc123");
    });

    it("redacts Bearer tokens", () => {
      const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      expect(sanitizeText(text)).toContain("Bearer [REDACTED_TOKEN]");
    });

    it("redacts api_key=value", () => {
      expect(sanitizeText("api_key=my-secret-key-12345")).toContain("api_key=[REDACTED]");
      expect(sanitizeText("apiKey: my-secret-key-12345")).toContain("apiKey: [REDACTED]");
    });

    it("redacts password=value", () => {
      expect(sanitizeText("password=hunter2")).toContain("password=[REDACTED]");
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
      expect(turn.content).toContain("[REDACTED_API_KEY]");
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
});
