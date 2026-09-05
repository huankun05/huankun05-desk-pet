/**
 * 思维链标签流式过滤器。
 *
 * 用于 AG-UI 事件桥层，防止模型的思维链标签泄漏到用户可见文本。
 *
 * 支持的标签变体（不区分大小写）：
 * - <think> / </think>
 * - <thinking> / </thinking>
 * - <reasoning> / </reasoning>
 * - <thought> / </thought>
 * - <REASONING_SCRATCHPAD> / </REASONING_SCRATCHPAD>
 *
 * 三种模式：
 * - "strict": 过滤全文所有思维链块（用于已知会混入 think 的模型）
 * - "leading-only": 只在消息开头（跳过空白后）以思维链标签开头时才进入过滤模式；
 *   否则原样透传。避免正文讨论标签或代码块中的标签被误删。
 * - "disabled": 不过滤，原样透传
 *
 * 额外处理：
 * - 孤立关闭标签（无匹配开放标签）自动移除，连同尾部空白
 * - 跨 chunk 标签分割正确处理
 *
 * 生命周期：按单条 assistant message（TEXT_MESSAGE_START ~ TEXT_MESSAGE_END）隔离，
 * 不贯穿整个 run。多轮 FC 循环中每次 LLM 调用都有独立的消息边界。
 */

export type ThinkFilterMode = "strict" | "leading-only" | "disabled";

export interface ThinkStreamFilter {
  /** 推入一个 chunk，返回过滤后的可见文本（可能为空字符串）。 */
  push(chunk: string): string;
  /** 消息结束时 flush 残留的可见文本（可能为空字符串）。 */
  flush(): string;
  /** 取出自上次读取后捕获到的公开思维链文本。 */
  takeThinking(): string;
}

// ── 标签定义 ───────────────────────────────────────────────

const THINK_TAG_NAMES = [
  "think",
  "thinking",
  "reasoning",
  "thought",
  "REASONING_SCRATCHPAD",
] as const;

const OPEN_TAGS: string[] = THINK_TAG_NAMES.map((name) => `<${name}>`);
const CLOSE_TAGS: string[] = THINK_TAG_NAMES.map((name) => `</${name}>`);

const MAX_TAG_LEN = Math.max(
  ...OPEN_TAGS.map((t) => t.length),
  ...CLOSE_TAGS.map((t) => t.length),
);

const MIN_OPEN_TAG_LEN = Math.min(...OPEN_TAGS.map((t) => t.length));

// ── 辅助函数 ───────────────────────────────────────────────

/** 查找最早的开放标签，返回 [索引, 长度]，未找到返回 [-1, 0]（不区分大小写） */
function findEarliestOpenTag(text: string): [number, number] {
  const lower = text.toLowerCase();
  let bestIdx = -1;
  let bestLen = 0;
  for (const tag of OPEN_TAGS) {
    const idx = lower.indexOf(tag.toLowerCase());
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
      bestLen = tag.length;
    }
  }
  return [bestIdx, bestLen];
}

/** 查找最早的关闭标签，返回 [索引, 长度]，未找到返回 [-1, 0]（不区分大小写） */
function findEarliestCloseTag(text: string): [number, number] {
  const lower = text.toLowerCase();
  let bestIdx = -1;
  let bestLen = 0;
  for (const tag of CLOSE_TAGS) {
    const idx = lower.indexOf(tag.toLowerCase());
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
      bestLen = tag.length;
    }
  }
  return [bestIdx, bestLen];
}

/** 检查文本是否以某个开放标签开头（不区分大小写） */
function startsWithOpenTag(text: string): boolean {
  const lower = text.toLowerCase();
  return OPEN_TAGS.some((tag) => lower.startsWith(tag.toLowerCase()));
}

/**
 * 移除孤立的关闭标签（无匹配开放标签），连同尾部空白。
 * 孤立关闭标签总是噪音，移除后让周围文本自然流动。
 */
function stripOrphanCloseTags(text: string): string {
  if (!text.includes("</")) return text;
  const lower = text.toLowerCase();
  let result = "";
  let i = 0;
  while (i < text.length) {
    let matched = false;
    if (lower.slice(i, i + 2) === "</") {
      for (const tag of CLOSE_TAGS) {
        const tagLower = tag.toLowerCase();
        if (lower.slice(i, i + tagLower.length) === tagLower) {
          // 跳过标签和尾部空白
          let j = i + tagLower.length;
          while (j < text.length && " \t\n\r".includes(text[j])) {
            j++;
          }
          i = j;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      result += text[i];
      i++;
    }
  }
  return result;
}

/**
 * 返回 buf 后缀中是任意标签前缀的最长长度。
 * 只有严格短于标签本身的前缀才算（完整长度的后缀就是标签本身，作为匹配处理）。
 * 不区分大小写。
 */
function maxPartialSuffix(buf: string, tags: string[]): number {
  if (!buf) return 0;
  const lower = buf.toLowerCase();
  const maxCheck = Math.min(lower.length, MAX_TAG_LEN - 1);
  for (let i = maxCheck; i > 0; i--) {
    const suffix = lower.slice(-i);
    for (const tag of tags) {
      const tagLower = tag.toLowerCase();
      if (tagLower.length > i && tagLower.startsWith(suffix)) {
        return i;
      }
    }
  }
  return 0;
}

// ── strict 模式过滤器 ──────────────────────────────────────

/**
 * 创建一个全量思维链过滤器（strict 模式内部使用）。
 * 跨 chunk 保持状态，处理标签被拆分的情况。
 * 移除孤立关闭标签。
 */
function createStrictFilter(): ThinkStreamFilter {
  let pending = "";
  let insideThink = false;
  let thinking = "";

  return {
    push(chunk: string): string {
      pending += chunk;
      let visible = "";

      while (pending) {
        if (insideThink) {
          const [closeIndex, closeLen] = findEarliestCloseTag(pending);
          if (closeIndex < 0) {
            // 只暂存可能是关闭标签前缀的尾部，其余归入思维链内容
            const held = maxPartialSuffix(pending, CLOSE_TAGS);
            thinking += held > 0 ? pending.slice(0, -held) : pending;
            pending = held > 0 ? pending.slice(-held) : "";
            break;
          }
          thinking += pending.slice(0, closeIndex);
          pending = pending.slice(closeIndex + closeLen);
          insideThink = false;
          continue;
        }

        const [openIndex, openLen] = findEarliestOpenTag(pending);
        if (openIndex < 0) {
          // 没找到开放标签，只暂存可能是标签前缀的尾部，其余输出
          const heldOpen = maxPartialSuffix(pending, OPEN_TAGS);
          const heldClose = maxPartialSuffix(pending, CLOSE_TAGS);
          const held = Math.max(heldOpen, heldClose);
          let emitText = held > 0 ? pending.slice(0, -held) : pending;
          pending = held > 0 ? pending.slice(-held) : "";
          // 移除孤立关闭标签
          emitText = stripOrphanCloseTags(emitText);
          visible += emitText;
          break;
        }

        // 找到开放标签，输出它之前的内容（移除孤立关闭标签）
        let preceding = pending.slice(0, openIndex);
        preceding = stripOrphanCloseTags(preceding);
        visible += preceding;
        pending = pending.slice(openIndex + openLen);
        insideThink = true;
      }

      return visible;
    },

    flush(): string {
      if (insideThink) {
        // 未闭合的思维链不进入正文，但仍可作为已公开的思考过程展示。
        thinking += pending;
        pending = "";
        return "";
      }
      let rest = pending;
      pending = "";
      rest = stripOrphanCloseTags(rest);
      return rest;
    },

    takeThinking(): string {
      const value = thinking;
      thinking = "";
      return value;
    },
  };
}

// ── leading-only 模式过滤器 ────────────────────────────────

/**
 * 创建一个 leading-only 过滤器。
 *
 * 行为：
 * 1. 初始为 "buffering" 态，累积字符直到能判断消息是否以思维链标签开头
 * 2. 如果开头（跳过空白）是思维链标签 -> 进入 "filtering" 态，后续全部走 strict 过滤
 * 3. 如果开头不是思维链标签 -> 进入 "passthrough" 态，后续原样透传
 */
function createLeadingOnlyFilter(): ThinkStreamFilter {
  type State = "buffering" | "filtering" | "passthrough";
  let state: State = "buffering";
  let buffer = "";
  const inner: ThinkStreamFilter = createStrictFilter();

  return {
    push(chunk: string): string {
      if (state === "passthrough") {
        // passthrough 状态也移除孤立关闭标签（跨 chunk 分割的边缘情况可能遗漏）
        return stripOrphanCloseTags(chunk);
      }

      if (state === "filtering") return inner.push(chunk);

      // state === "buffering"
      buffer += chunk;
      const trimmed = buffer.trimStart();

      // 已确定以某个思维链标签开头
      if (startsWithOpenTag(trimmed)) {
        state = "filtering";
        const result = inner.push(buffer);
        buffer = "";
        return result;
      }

      // 第一个非空白字符不是 '<'，确定不是思维链标签
      if (trimmed.length > 0 && !trimmed.startsWith("<")) {
        state = "passthrough";
        const result = stripOrphanCloseTags(buffer);
        buffer = "";
        return result;
      }

      // 以 '<' 开头但还不够最长标签长度判断
      if (trimmed.length >= MAX_TAG_LEN && !startsWithOpenTag(trimmed)) {
        state = "passthrough";
        const result = stripOrphanCloseTags(buffer);
        buffer = "";
        return result;
      }

      // 字符不够，继续缓冲
      return "";
    },

    flush(): string {
      if (state === "passthrough") return "";
      if (state === "buffering") {
        // 消息结束仍未遇到思维链标签，输出全部缓冲
        state = "passthrough";
        const result = stripOrphanCloseTags(buffer);
        buffer = "";
        return result;
      }
      // state === "filtering"
      return inner.flush();
    },

    takeThinking(): string {
      return state === "filtering" ? inner.takeThinking() : "";
    },
  };
}

// ── 公共 API ───────────────────────────────────────────────

/**
 * 创建思维链流式过滤器。
 *
 * @param mode "strict" | "leading-only" | "disabled"
 * - "strict": 过滤全文所有思维链块
 * - "leading-only": 只过滤消息开头的思维链块（默认，最安全）
 * - "disabled": 不过滤，原样透传
 */
export function createThinkFilter(mode: ThinkFilterMode = "leading-only"): ThinkStreamFilter {
  if (mode === "disabled") {
    return { push: (s: string) => s, flush: () => "", takeThinking: () => "" };
  }
  if (mode === "strict") {
    return createStrictFilter();
  }
  return createLeadingOnlyFilter();
}

/**
 * 对完整文本一次性剥离思维链块（非流式场景使用）。
 * 支持所有标签变体，移除孤立关闭标签。
 * 未闭合开放标签之后的内容会被丢弃。
 */
export function stripThinkBlocks(text: string): string {
  let result = text;
  for (const name of THINK_TAG_NAMES) {
    const open = `<${name}>`;
    const close = `</${name}>`;
    // 移除闭合对（非贪婪）
    const pairRegex = new RegExp(`${open}[\\s\\S]*?${close}`, "gi");
    result = result.replace(pairRegex, "");
    // 移除未闭合的开放标签及其后内容
    const openRegex = new RegExp(`${open}[\\s\\S]*$`, "gi");
    result = result.replace(openRegex, "");
  }
  // 移除孤立关闭标签
  result = stripOrphanCloseTags(result);
  return result.trim();
}
