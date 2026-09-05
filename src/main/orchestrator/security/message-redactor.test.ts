import { describe, it, expect } from "vitest";
import {
  maskSecret,
  redactSensitiveText,
  redactObject,
} from "./message-redactor";

// ── maskSecret 测试 ─────────────────────────────────────────

describe("maskSecret", () => {
  it("保留前 4 和后 4 字符", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("abcd...mnop");
  });

  it("短于 floor 的完全脱敏", () => {
    expect(maskSecret("short")).toBe("***");
  });

  it("空值返回 empty", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("", { empty: "(not set)" })).toBe("(not set)");
  });

  it("自定义 head/tail/floor", () => {
    expect(maskSecret("abcdefghijklmnop", { head: 2, tail: 2, floor: 10 })).toBe("ab...op");
  });

  it("自定义 placeholder", () => {
    expect(maskSecret("short", { placeholder: "[REDACTED]" })).toBe("[REDACTED]");
  });
});

// ── 已知 API key 前缀脱敏 ───────────────────────────────────

describe("已知 API key 前缀脱敏", () => {
  it("OpenAI sk- 前缀", () => {
    const result = redactSensitiveText("key is sk-proj-abcdef1234567890abcdef");
    expect(result).toContain("sk-pro...cdef");
    expect(result).not.toContain("abcdef1234567890");
  });

  it("GitHub ghp_ 前缀", () => {
    const result = redactSensitiveText("token: ghp_abcdefghijklmnop1234567890");
    expect(result).toContain("ghp_ab...7890");
  });

  it("Slack xoxb- 前缀", () => {
    const result = redactSensitiveText("xoxb-1234567890-abcdefghijklmnop");
    expect(result).toContain("xoxb-1...mnop");
  });

  it("Google AIza 前缀", () => {
    const result = redactSensitiveText("AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567");
    expect(result).toContain("AIzaSy...4567");
  });

  it("AWS AKIA 前缀", () => {
    const result = redactSensitiveText("AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("AKIAIO...MPLE");
  });

  it("Stripe sk_live_ 前缀", () => {
    const result = redactSensitiveText("sk_live_abcdefghijklmnop1234567890");
    expect(result).toContain("sk_liv...7890");
  });

  it("HuggingFace hf_ 前缀", () => {
    const result = redactSensitiveText("hf_abcdefghijklmnopqrstuvwxyz1234");
    expect(result).toContain("hf_abc...1234");
  });

  it("npm npm_ 前缀", () => {
    const result = redactSensitiveText("npm_abcdefghijklmnopqrstuvwxyz1234");
    expect(result).toContain("npm_ab...1234");
  });

  it("短于 18 字符的 token 完全脱敏", () => {
    // sk- 前缀 + 10 字符 = 13 字符，匹配前缀正则但短于 18，完全脱敏
    const result = redactSensitiveText("sk-abcdefghij");
    expect(result).toContain("***");
  });

  it("不影响普通文本", () => {
    const result = redactSensitiveText("这是一段普通文本，没有敏感信息");
    expect(result).toBe("这是一段普通文本，没有敏感信息");
  });
});

// ── ENV 赋值脱敏 ────────────────────────────────────────────

describe("ENV 赋值脱敏", () => {
  it("OPENAI_API_KEY=value", () => {
    const result = redactSensitiveText("OPENAI_API_KEY=sk-proj-abcdef1234567890");
    expect(result).toContain("OPENAI_API_KEY=***");
  });

  it("带引号的 ENV 赋值", () => {
    const result = redactSensitiveText('export TOKEN="abcdefghijklmnop1234567890"');
    expect(result).toContain('TOKEN="abcdef...7890"');
  });

  it("PASSWORD=value", () => {
    const result = redactSensitiveText("DB_PASSWORD=mysecretpassword123");
    expect(result).toContain("DB_PASSWORD=mysecr...d123");
  });

  it("不影响普通 ENV 赋值", () => {
    const result = redactSensitiveText("NODE_ENV=production");
    expect(result).toBe("NODE_ENV=production");
  });
});

// ── JSON 字段脱敏 ───────────────────────────────────────────

describe("JSON 字段脱敏", () => {
  it('"apiKey": "value"', () => {
    const result = redactSensitiveText('{"apiKey": "sk-proj-abcdef1234567890"}');
    expect(result).toContain('"apiKey": "***"');
  });

  it('"token": "value"', () => {
    const result = redactSensitiveText('{"token": "abcdefghijklmnop1234567890"}');
    expect(result).toContain('"token": "abcdef...7890"');
  });

  it('"password": "value"', () => {
    const result = redactSensitiveText('{"password": "mysecretpassword123"}');
    expect(result).toContain('"password": "mysecr...d123"');
  });

  it('"access_token": "value"', () => {
    const result = redactSensitiveText('{"access_token": "abcdefghijklmnop1234567890"}');
    expect(result).toContain('"access_token": "abcdef...7890"');
  });

  it("不影响普通 JSON 字段", () => {
    const result = redactSensitiveText('{"name": "John", "age": 30}');
    expect(result).toBe('{"name": "John", "age": 30}');
  });
});

// ── YAML 字段脱敏 ───────────────────────────────────────────

describe("YAML 字段脱敏", () => {
  it("apiKey: value（驼峰命名）", () => {
    const result = redactSensitiveText("apiKey: abcdefghijklmnop1234567890");
    expect(result).toContain("apiKey: abcdef...7890");
  });

  it("api_key: value（下划线命名）", () => {
    const result = redactSensitiveText("api_key: abcdefghijklmnop1234567890");
    expect(result).toContain("api_key: abcdef...7890");
  });

  it("token: value", () => {
    const result = redactSensitiveText("token: abcdefghijklmnop1234567890");
    expect(result).toContain("token: abcdef...7890");
  });

  it("password: value（短于18字符完全脱敏）", () => {
    const result = redactSensitiveText("password: mysecret123");
    expect(result).toContain("password: ***");
  });

  it("secret: value（带引号）", () => {
    const result = redactSensitiveText('secret: "abcdefghijklmnop1234567890"');
    expect(result).toContain('secret: "abcdef...7890"');
  });

  it("不影响普通 YAML 字段", () => {
    const result = redactSensitiveText("name: John\nage: 30");
    expect(result).toBe("name: John\nage: 30");
  });

  it("不对已脱敏的值进行二次脱敏", () => {
    // 已知前缀先脱敏为 ghp_ab...7890，YAML 字段不应再二次脱敏
    const result = redactSensitiveText("token: ghp_abcdefghijklmnop1234567890");
    expect(result).toContain("ghp_ab...7890");
    expect(result).not.toContain("***");
  });

  it("不匹配 Authorization header（由 AUTH_HEADER_RE 处理）", () => {
    const result = redactSensitiveText("Authorization: Bearer abcdefghijklmnop1234567890");
    expect(result).toContain("Authorization: Bearer abcdef...7890");
  });
});

// ── Authorization header 脱敏 ───────────────────────────────

describe("Authorization header 脱敏", () => {
  it("Bearer token", () => {
    const result = redactSensitiveText("Authorization: Bearer abcdefghijklmnop1234567890");
    expect(result).toContain("Authorization: Bearer abcdef...7890");
  });

  it("小写 authorization", () => {
    const result = redactSensitiveText("authorization: bearer abcdefghijklmnop1234567890");
    expect(result).toContain("authorization: bearer abcdef...7890");
  });
});

// ── 私钥块脱敏 ──────────────────────────────────────────────

describe("私钥块脱敏", () => {
  it("RSA 私钥", () => {
    const key = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds5xfn/8Mb3r0v0Y5H3QE0c5v6K7u8t9w
x0y1z2a3b4c5d6e7f8g9h0i1j2k3l4m5n6o7p8q9r0s1t2u3v4w5x6y7z8
-----END RSA PRIVATE KEY-----`;
    const result = redactSensitiveText(key);
    expect(result).toContain("[REDACTED PRIVATE KEY]");
    expect(result).not.toContain("MIIEpAIBAAKCAQEA");
  });
});

// ── 数据库连接字符串脱敏 ────────────────────────────────────

describe("数据库连接字符串脱敏", () => {
  it("PostgreSQL 连接串", () => {
    const result = redactSensitiveText("postgres://user:mypassword@localhost:5432/mydb");
    expect(result).toContain("postgres://user:***@localhost:5432/mydb");
  });

  it("MySQL 连接串", () => {
    const result = redactSensitiveText("mysql://root:secret123@127.0.0.1:3306/test");
    expect(result).toContain("mysql://root:***@127.0.0.1:3306/test");
  });

  it("MongoDB 连接串", () => {
    const result = redactSensitiveText("mongodb://admin:passw0rd@cluster0.mongodb.net/db");
    expect(result).toContain("mongodb://admin:***@cluster0.mongodb.net/db");
  });
});

// ── JWT token 脱敏 ──────────────────────────────────────────

describe("JWT token 脱敏", () => {
  it("完整 JWT（三部分）", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = redactSensitiveText(jwt);
    expect(result).toContain("eyJhbG...sw5c");
  });

  it("两部分 JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const result = redactSensitiveText(jwt);
    expect(result).toContain("eyJhbG...wIn0");
  });
});

// ── URL 查询参数脱敏 ────────────────────────────────────────

describe("URL 查询参数脱敏", () => {
  it("token 查询参数", () => {
    const result = redactSensitiveText("https://example.com/cb?token=abc123&state=xyz");
    expect(result).toContain("token=***");
    expect(result).toContain("state=xyz");
  });

  it("api_key 查询参数", () => {
    const result = redactSensitiveText("https://api.example.com/v1?api_key=mykey123&limit=10");
    expect(result).toContain("api_key=***");
    expect(result).toContain("limit=10");
  });

  it("password 查询参数", () => {
    const result = redactSensitiveText("https://example.com/login?password=secret123&user=john");
    expect(result).toContain("password=***");
    expect(result).toContain("user=john");
  });
});

// ── URL userinfo 脱敏 ───────────────────────────────────────

describe("URL userinfo 脱敏", () => {
  it("user:password@host", () => {
    const result = redactSensitiveText("https://user:mypassword@api.example.com/v1/foo");
    expect(result).toContain("https://user:***@api.example.com/v1/foo");
  });
});

// ── 手机号脱敏 ──────────────────────────────────────────────

describe("手机号脱敏", () => {
  it("中国手机号", () => {
    const result = redactSensitiveText("联系电话：+8613812345678");
    expect(result).toContain("+861****5678");
  });

  it("美国手机号", () => {
    const result = redactSensitiveText("Call me at +12345678901");
    expect(result).toContain("+123****8901");
  });
});

// ── codeFile 模式 ───────────────────────────────────────────

describe("codeFile 模式", () => {
  it("跳过 ENV 赋值（避免误匹配源代码常量）", () => {
    const code = 'const MAX_TOKENS = 8192;\nconst API_KEY = "test";';
    const result = redactSensitiveText(code, { codeFile: true });
    // ENV 赋值被跳过，但 JSON 字段也被跳过
    expect(result).toContain('const API_KEY = "test";');
  });

  it("仍然脱敏已知 API key 前缀", () => {
    const code = 'const key = "sk-proj-abcdef1234567890abcdef";';
    const result = redactSensitiveText(code, { codeFile: true });
    expect(result).toContain("sk-pro...cdef");
  });

  it("仍然脱敏私钥块", () => {
    const code = 'const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";';
    const result = redactSensitiveText(code, { codeFile: true });
    expect(result).toContain("[REDACTED PRIVATE KEY]");
  });
});

// ── enabled=false 模式 ──────────────────────────────────────

describe("enabled=false 模式", () => {
  it("不脱敏", () => {
    const result = redactSensitiveText("key is sk-proj-abcdef1234567890abcdef", { enabled: false });
    expect(result).toBe("key is sk-proj-abcdef1234567890abcdef");
  });
});

// ── force 模式 ──────────────────────────────────────────────

describe("force 模式", () => {
  it("即使 enabled=false 也脱敏", () => {
    const result = redactSensitiveText("key is sk-proj-abcdef1234567890abcdef", { enabled: false, force: true });
    expect(result).toContain("sk-pro...cdef");
  });
});

// ── redactObject 递归脱敏 ───────────────────────────────────

describe("redactObject", () => {
  it("递归脱敏对象中的字符串", () => {
    const obj = {
      name: "John",
      apiKey: "sk-proj-abcdef1234567890abcdef",
      nested: {
        token: "sk-proj-abcdef1234567890abcdef",
        count: 42,
      },
      tags: ["a", "b"],
    };
    const result = redactObject(obj);
    expect(result.name).toBe("John");
    expect(result.apiKey).toContain("sk-pro...cdef");
    expect(result.nested.token).toContain("sk-pro...cdef");
    expect(result.nested.count).toBe(42);
    expect(result.tags).toEqual(["a", "b"]);
  });

  it("处理数组", () => {
    const arr = ["hello", "sk-proj-abcdef1234567890abcdef", 42];
    const result = redactObject(arr);
    expect(result[0]).toBe("hello");
    expect(result[1]).toContain("sk-pro...cdef");
    expect(result[2]).toBe(42);
  });

  it("处理 null 和 undefined", () => {
    expect(redactObject(null)).toBeNull();
    expect(redactObject(undefined)).toBeUndefined();
  });

  it("处理原始类型", () => {
    expect(redactObject(42)).toBe(42);
    expect(redactObject(true)).toBe(true);
  });
});

// ── 综合测试 ─────────────────────────────────────────────────

describe("综合脱敏", () => {
  it("多种敏感信息同时出现", () => {
    const text = `
配置信息：
- OPENAI_API_KEY=sk-proj-abcdef1234567890abcdef
- 数据库：postgres://user:mypassword@localhost:5432/mydb
- API 地址：https://api.example.com/v1?token=abc123
- 手机号：+8613812345678
- JWT：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
`;
    const result = redactSensitiveText(text);
    expect(result).toContain("OPENAI_API_KEY=***");
    expect(result).toContain("postgres://user:***@localhost:5432/mydb");
    expect(result).toContain("token=***");
    expect(result).toContain("+861****5678");
    expect(result).toContain("eyJhbG...sw5c");
    // 不影响普通文本
    expect(result).toContain("配置信息");
  });

  it("空字符串原样返回", () => {
    expect(redactSensitiveText("")).toBe("");
  });

  it("非字符串输入转换为字符串", () => {
    const result = redactSensitiveText(12345 as unknown as string);
    expect(result).toBe("12345");
  });
});
