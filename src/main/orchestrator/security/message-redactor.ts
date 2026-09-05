// Message Redactor — 基于正则的敏感信息脱敏
//
// 移植自 Hermes agent/redact.py，用于在日志、工具输出、trajectory 导出等
// 场景中自动脱敏 API key、token、密码等敏感信息。
//
// 设计原则：
// - 核心逻辑是纯函数，易于测试
// - 短 token（< 18 字符）完全脱敏；长 token 保留前 6 和后 4 字符便于调试
// - 每个正则模式都有廉价的子串预检查，提升性能
// - 默认启用脱敏（安全默认），可通过配置关闭
// - codeFile 模式跳过 ENV 赋值和 JSON 字段正则（避免误匹配源代码常量）

// ── 敏感参数名 ─────────────────────────────────────────────

/** 敏感查询参数名（不区分大小写精确匹配） */
const SENSITIVE_QUERY_PARAMS = new Set([
  "access_token", "refresh_token", "id_token", "token",
  "api_key", "apikey", "client_secret", "password",
  "auth", "jwt", "session", "secret", "key",
  "code", "signature", "x-amz-signature",
]);

/** 敏感 body key 名（不区分大小写精确匹配，非子串匹配） */
const SENSITIVE_BODY_KEYS = new Set([
  "access_token", "refresh_token", "id_token", "token",
  "api_key", "apikey", "client_secret", "password",
  "auth", "jwt", "secret", "private_key", "authorization", "key",
]);

// ── 已知 API key 前缀模式 ───────────────────────────────────

const PREFIX_PATTERNS: string[] = [
  "sk-[A-Za-z0-9_-]{10,}",           // OpenAI / OpenRouter / Anthropic (sk-ant-*)
  "ghp_[A-Za-z0-9]{10,}",            // GitHub PAT (classic)
  "github_pat_[A-Za-z0-9_]{10,}",    // GitHub PAT (fine-grained)
  "gho_[A-Za-z0-9]{10,}",            // GitHub OAuth access token
  "ghu_[A-Za-z0-9]{10,}",            // GitHub user-to-server token
  "ghs_[A-Za-z0-9]{10,}",            // GitHub server-to-server token
  "ghr_[A-Za-z0-9]{10,}",            // GitHub refresh token
  "xox[baprs]-[A-Za-z0-9-]{10,}",    // Slack tokens
  "AIza[A-Za-z0-9_-]{30,}",          // Google API keys
  "pplx-[A-Za-z0-9]{10,}",           // Perplexity
  "fal_[A-Za-z0-9_-]{10,}",          // Fal.ai
  "fc-[A-Za-z0-9]{10,}",             // Firecrawl
  "bb_live_[A-Za-z0-9_-]{10,}",      // BrowserBase
  "gAAAA[A-Za-z0-9_=-]{20,}",        // Codex encrypted tokens
  "AKIA[A-Z0-9]{16}",                // AWS Access Key ID
  "sk_live_[A-Za-z0-9]{10,}",        // Stripe secret key (live)
  "sk_test_[A-Za-z0-9]{10,}",        // Stripe secret key (test)
  "rk_live_[A-Za-z0-9]{10,}",        // Stripe restricted key
  "SG\\.[A-Za-z0-9_-]{10,}",          // SendGrid API key
  "hf_[A-Za-z0-9]{10,}",             // HuggingFace token
  "r8_[A-Za-z0-9]{10,}",             // Replicate API token
  "npm_[A-Za-z0-9]{10,}",            // npm access token
  "pypi-[A-Za-z0-9_-]{10,}",         // PyPI API token
  "dop_v1_[A-Za-z0-9]{10,}",         // DigitalOcean PAT
  "doo_v1_[A-Za-z0-9]{10,}",         // DigitalOcean OAuth
  "am_[A-Za-z0-9_-]{10,}",           // AgentMail API key
  "sk_[A-Za-z0-9_]{10,}",            // ElevenLabs TTS key (sk_ underscore)
  "tvly-[A-Za-z0-9]{10,}",           // Tavily search API key
  "exa_[A-Za-z0-9]{10,}",            // Exa search API key
  "gsk_[A-Za-z0-9]{10,}",            // Groq Cloud API key
  "syt_[A-Za-z0-9]{10,}",            // Matrix access token
  "retaindb_[A-Za-z0-9]{10,}",       // RetainDB API key
  "hsk-[A-Za-z0-9]{10,}",            // Hindsight API key
  "mem0_[A-Za-z0-9]{10,}",           // Mem0 Platform API key
  "brv_[A-Za-z0-9]{10,}",            // ByteRover API key
  "xai-[A-Za-z0-9]{30,}",            // xAI (Grok) API key
  "ntn_[A-Za-z0-9]{10,}",            // Notion internal integration token
];

/** 从正则模式中提取前导字面字符（用于子串预检查） */
function extractLiteralPrefix(pattern: string): string {
  const meta = "[(\\.?*+|{^$";
  for (let i = 0; i < pattern.length; i++) {
    if (meta.includes(pattern[i])) {
      return pattern.slice(0, i);
    }
  }
  return pattern;
}

/** 已知 API key 前缀的子串列表（用于廉价预检查） */
const PREFIX_SUBSTRINGS = PREFIX_PATTERNS.map(extractLiteralPrefix);

/** 检查文本是否包含任何已知 API key 前缀子串 */
function hasKnownPrefixSubstring(text: string): boolean {
  return PREFIX_SUBSTRINGS.some((p) => text.includes(p));
}

/** 编译后的前缀正则（带边界断言） */
const PREFIX_RE = new RegExp(
  "(?<![A-Za-z0-9_-])(" + PREFIX_PATTERNS.join("|") + ")(?![A-Za-z0-9_-])",
  "g",
);

// ── 其他正则模式 ────────────────────────────────────────────

/** ENV 赋值模式：KEY=value，其中 KEY 包含敏感名 */
/** 负向回顾断言 (?<![?&]) 确保不匹配 URL 查询参数；[^\s&]+ 避免贪婪匹配吞掉 & 后面的参数 */
const SECRET_ENV_NAMES = "(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)";
const ENV_ASSIGN_RE = new RegExp(
  `(?<![?&])([A-Z0-9_]{0,50}${SECRET_ENV_NAMES}[A-Z0-9_]{0,50})\\s*=\\s*(['"]?)([^\\s&]+)\\2`,
  "gi",
);

/** JSON 字段模式："apiKey": "value" */
const JSON_KEY_NAMES = "(?:api_?[Kk]ey|token|secret|password|access_token|refresh_token|auth_token|bearer|secret_value|raw_secret|secret_input|key_material)";
const JSON_FIELD_RE = new RegExp(
  `("${JSON_KEY_NAMES}")\\s*:\\s*"([^"]+)"`,
  "gi",
);

/** YAML 字段模式：apiKey: value（冒号分隔，不带引号）
 *  注意：只匹配敏感 key 名，避免误匹配正常文本
 *  key 名支持驼峰（apiKey）和下划线（api_key）命名
 *  不包含 authorization/auth，因为它们由 AUTH_HEADER_RE 专门处理
 */
const YAML_KEY_NAMES = "(?:api[Kk]ey|api_key|token|secret|password|passwd|access_token|refresh_token|auth_token|bearer|credential|private_key)";
const YAML_FIELD_RE = new RegExp(
  `(?<![A-Za-z0-9_-])(${YAML_KEY_NAMES})\\s*:\\s+(['"]?)(?!.*\\.\\.\\.)([^\\s'"\r\n]+)\\2`,
  "gi",
);

/** Authorization header */
const AUTH_HEADER_RE = /(Authorization:\s*Bearer\s+)(\S+)/gi;

/** Telegram bot token */
const TELEGRAM_RE = /(bot)?(\d{8,}):([-A-Za-z0-9_]{30,})/g;

/** 私钥块 */
const PRIVATE_KEY_RE = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;

/** 数据库连接字符串 */
const DB_CONNSTR_RE = /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi;

/** JWT token */
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_=-]{4,}){0,2}/g;

/** E.164 手机号 */
const SIGNAL_PHONE_RE = /(\+[1-9]\d{6,14})(?![A-Za-z0-9])/g;

/** URL 带查询字符串 */
const URL_WITH_QUERY_RE = /(https?|wss?|ftp):\/\/([^\s/?#]+)([^\s?#]*)\?([^\s#]+)(#\S*)?/g;

/** URL userinfo */
const URL_USERINFO_RE = /(https?|wss?|ftp):\/\/([^/\s:@]+):([^/\s@]+)@/g;

/** HTTP request target 查询字符串 */
const HTTP_REQUEST_TARGET_QUERY_RE = /\b((?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+[^ \t\r\n"']*?)\?([^ \t\r\n"']+)/gi;

/** Form-urlencoded body */
const FORM_BODY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*=[^&\s]*(?:&[A-Za-z_][A-Za-z0-9_.-]*=[^&\s]*)+$/;

// ── 脱敏选项 ────────────────────────────────────────────────

export interface RedactOptions {
  /** 强制脱敏（安全边界，不管全局配置） */
  force?: boolean;
  /** 代码文件模式（跳过 ENV 赋值和 JSON 字段正则） */
  codeFile?: boolean;
  /** 是否启用脱敏（默认 true） */
  enabled?: boolean;
}

// ── 通用脱敏函数 ────────────────────────────────────────────

export interface MaskSecretOptions {
  /** 保留前导字符数（默认 4） */
  head?: number;
  /** 保留尾部字符数（默认 4） */
  tail?: number;
  /** 短于此值的完全脱敏（默认 12） */
  floor?: number;
  /** 完全脱敏时的占位符（默认 "***"） */
  placeholder?: string;
  /** 空值时的返回值（默认 ""） */
  empty?: string;
}

/**
 * 通用脱敏函数，保留前 head 和后 tail 字符。
 * 短于 floor 的值完全脱敏。
 */
export function maskSecret(value: string, options: MaskSecretOptions = {}): string {
  const { head = 4, tail = 4, floor = 12, placeholder = "***", empty = "" } = options;
  if (!value) return empty;
  if (value.length < floor) return placeholder;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

/** 日志 token 脱敏：保守 18 字符下限，保留 6 前缀 / 4 后缀 */
function maskToken(token: string): string {
  if (!token) return "***";
  return maskSecret(token, { head: 6, tail: 4, floor: 18 });
}

// ── 查询字符串脱敏 ──────────────────────────────────────────

/** 脱敏 URL 查询字符串中的敏感参数值 */
function redactQueryString(query: string): string {
  if (!query) return query;
  const parts: string[] = [];
  for (const pair of query.split("&")) {
    if (!pair.includes("=")) {
      parts.push(pair);
      continue;
    }
    const eqIndex = pair.indexOf("=");
    const key = pair.slice(0, eqIndex);
    const value = pair.slice(eqIndex + 1);
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      parts.push(`${key}=***`);
    } else {
      parts.push(pair);
    }
  }
  return parts.join("&");
}

/** 脱敏文本中 URL 的查询参数 */
function redactUrlQueryParams(text: string): string {
  return text.replace(URL_WITH_QUERY_RE, (match, scheme, authority, path, query, fragment) => {
    const redactedQuery = redactQueryString(query);
    return `${scheme}://${authority}${path}?${redactedQuery}${fragment || ""}`;
  });
}

/** 脱敏 URL userinfo（user:password@host） */
function redactUrlUserinfo(text: string): string {
  return text.replace(URL_USERINFO_RE, (match, scheme, user) => {
    return `${scheme}://${user}:***@`;
  });
}

/** 脱敏 HTTP request target 查询参数 */
function redactHttpRequestTargetQueryParams(text: string): string {
  return text.replace(HTTP_REQUEST_TARGET_QUERY_RE, (match, prefix, query) => {
    return `${prefix}?${redactQueryString(query)}`;
  });
}

/** 脱敏 form-urlencoded body（仅在整个文本是纯 form body 时触发） */
function redactFormBody(text: string): string {
  if (!text || text.includes("\n") || !text.includes("&")) return text;
  if (!FORM_BODY_RE.test(text.trim())) return text;
  return redactQueryString(text.trim());
}

// ── 主脱敏函数 ──────────────────────────────────────────────

/**
 * 对文本应用所有脱敏模式。
 *
 * 安全调用：非匹配文本原样返回。
 * 默认启用脱敏。设置 force=true 用于必须永远返回脱敏值的安全边界。
 * 设置 codeFile=true 跳过 ENV 赋值和 JSON 字段正则（避免误匹配源代码常量），
 * 但前缀模式、auth header、私钥、DB 连接串、JWT、URL 秘密仍然脱敏。
 *
 * 性能优化：每个正则模式都有廉价的子串预检查，在典型日志行上
 * 从 ~5.6us 降到 ~1.8us（-68%）。
 */
export function redactSensitiveText(text: string, options: RedactOptions = {}): string {
  const { force = false, codeFile = false, enabled = true } = options;

  if (text == null) return text as unknown as string;
  if (typeof text !== "string") text = String(text);
  if (!text) return text;
  if (!(force || enabled)) return text;

  // 1. 已知 API key 前缀（sk-, ghp_, 等）
  if (hasKnownPrefixSubstring(text)) {
    text = text.replace(PREFIX_RE, (match, token) => maskToken(token));
  }

  // 2. ENV 赋值和 JSON 字段（codeFile 模式跳过，避免误匹配源代码）
  if (!codeFile) {
    if (text.includes("=")) {
      text = text.replace(ENV_ASSIGN_RE, (match, name, quote, value) => {
        return `${name}=${quote}${maskToken(value)}${quote}`;
      });
    }

    if (text.includes(":") && text.includes('"')) {
      text = text.replace(JSON_FIELD_RE, (match, key, value) => {
        return `${key}: "${maskToken(value)}"`;
      });
    }

    // YAML 字段：apiKey: value（冒号分隔，不带引号）
    if (text.includes(":")) {
      text = text.replace(YAML_FIELD_RE, (match, key, quote, value) => {
        return `${key}: ${quote}${maskToken(value)}${quote}`;
      });
    }
  }

  // 3. Authorization header
  if (text.includes("uthorization") || text.includes("UTHORIZATION")) {
    text = text.replace(AUTH_HEADER_RE, (match, prefix, token) => {
      return prefix + maskToken(token);
    });
  }

  // 4. Telegram bot token
  if (text.includes(":")) {
    text = text.replace(TELEGRAM_RE, (match, botPrefix, digits) => {
      return `${botPrefix || ""}${digits}:***`;
    });
  }

  // 5. 私钥块
  if (text.includes("BEGIN") && text.includes("-----")) {
    text = text.replace(PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]");
  }

  // 6. 数据库连接字符串密码
  if (text.includes("://")) {
    text = text.replace(DB_CONNSTR_RE, (match, prefix, _password, suffix) => {
      return `${prefix}***${suffix}`;
    });
  }

  // 7. JWT token
  if (text.includes("eyJ")) {
    text = text.replace(JWT_RE, (match) => maskToken(match));
  }

  // 8. URL 查询参数和 userinfo（默认启用，因为 Cyrene 场景中 OAuth 回调较少）
  if (text.includes("://") && text.includes("?")) {
    text = redactUrlQueryParams(text);
  }
  if (text.includes("://") && text.includes("@")) {
    text = redactUrlUserinfo(text);
  }

  // 9. HTTP request target 查询参数
  if (/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s/i.test(text)) {
    text = redactHttpRequestTargetQueryParams(text);
  }

  // 10. Form-urlencoded body
  if (text.includes("&") && text.includes("=")) {
    text = redactFormBody(text);
  }

  // 11. E.164 手机号
  if (text.includes("+")) {
    text = text.replace(SIGNAL_PHONE_RE, (match, phone) => {
      if (phone.length <= 8) {
        return phone.slice(0, 2) + "****" + phone.slice(-2);
      }
      return phone.slice(0, 4) + "****" + phone.slice(-4);
    });
  }

  return text;
}

// ── 便捷函数 ────────────────────────────────────────────────

/**
 * 对对象的所有字符串值递归脱敏。
 * 用于 trajectory 导出、日志记录等场景。
 */
export function redactObject<T>(obj: T, options: RedactOptions = {}): T {
  if (obj == null) return obj;
  if (typeof obj === "string") {
    return redactSensitiveText(obj, options) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, options)) as unknown as T;
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactObject(value, options);
    }
    return result as unknown as T;
  }
  return obj;
}
