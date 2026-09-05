// Think Scrubber — 流式思维链清理器（移植自 Hermes agent/think_scrubber.py）
//
// 核心目标：在流式输出中移除思维链标签（<think>、<thinking>、<reasoning>、
// <thought>、<REASONING_SCRATCHPAD>），避免把模型的推理过程展示给用户。
//
// 为什么需要状态机：
// - 简单的正则替换在完整字符串上有效，但在流式 delta 中会失效
// - 例如 delta1="<think>", delta2="推理内容", delta3="</think>"
// - 逐 delta 正则会把 delta1 删掉，delta2 就被当作普通内容泄露
//
// 设计原则：
// - 纯状态机，不依赖外部库，可独立测试
// - 部分标签跨 delta 时暂存，等待下一个 delta 解析
// - 闭合对 <tag>X</tag> 总是移除（无论边界）
// - 未闭合开放标签只有在块边界（行首/换行后）才视为思维链开始
// - 孤立关闭标签（无匹配开放）移除
//
// 用法：
//   const scrubber = new StreamingThinkScrubber();
//   for (const delta of stream) {
//     const visible = scrubber.feed(delta);
//     if (visible) emit(visible);
//   }
//   const tail = scrubber.flush();
//   if (tail) emit(tail);

/** 思维链标签名称（不区分大小写） */
const OPEN_TAG_NAMES = [
  "think",
  "thinking",
  "reasoning",
  "thought",
  "REASONING_SCRATCHPAD",
] as const;

/** 开放标签字符串数组 */
const OPEN_TAGS: string[] = OPEN_TAG_NAMES.map((name) => `<${name}>`);

/** 关闭标签字符串数组 */
const CLOSE_TAGS: string[] = OPEN_TAG_NAMES.map((name) => `</${name}>`);

/** 最长标签长度（用于部分标签暂存边界） */
const MAX_TAG_LEN = Math.max(...OPEN_TAGS.map((t) => t.length), ...CLOSE_TAGS.map((t) => t.length));

/**
 * 流式思维链清理器
 *
 * 状态机：
 * - inBlock：是否在思维链块内（等待关闭标签），块内所有文本丢弃
 * - buf：暂存的部分标签尾部（跨 delta 的标签分割）
 * - lastEmittedEndedNewline：上一次输出是否以换行结尾（用于判断块边界）
 */
export class StreamingThinkScrubber {
  private inBlock = false;
  private buf = "";
  private lastEmittedEndedNewline = true;

  /** 重置所有状态。每轮新对话开始时调用。 */
  reset(): void {
    this.inBlock = false;
    this.buf = "";
    this.lastEmittedEndedNewline = true;
  }

  /**
   * 输入一个 delta，返回清理后的可见部分。
   * 可能返回空字符串（整个 delta 都是思维链内容，或正在暂存部分标签）。
   */
  feed(text: string): string {
    if (!text) return "";

    let buf = this.buf + text;
    this.buf = "";
    const out: string[] = [];

    while (buf) {
      if (this.inBlock) {
        // 在思维链块内：寻找最早的关闭标签
        const [closeIdx, closeLen] = this.findFirstTag(buf, CLOSE_TAGS);
        if (closeIdx === -1) {
          // 还没找到关闭标签：暂存可能的部分关闭标签前缀，丢弃其余
          const held = this.maxPartialSuffix(buf, CLOSE_TAGS);
          this.buf = held > 0 ? buf.slice(-held) : "";
          return out.join("");
        }
        // 找到关闭标签：丢弃块内容+标签，继续
        buf = buf.slice(closeIdx + closeLen);
        this.inBlock = false;
      } else {
        // 优先级1：闭合对 <tag>X</tag>（总是移除，无论边界）
        const pair = this.findEarliestClosedPair(buf);
        // 优先级2：块边界处的未闭合开放标签
        const [openIdx, openLen] = this.findOpenAtBoundary(buf, out);

        // 取最早的匹配
        if (pair !== null && (openIdx === -1 || pair[0] <= openIdx)) {
          const [startIdx, endIdx] = pair;
          const preceding = buf.slice(0, startIdx);
          if (preceding) {
            const stripped = this.stripOrphanCloseTags(preceding);
            if (stripped) {
              out.push(stripped);
              this.lastEmittedEndedNewline = stripped.endsWith("\n");
            }
          }
          buf = buf.slice(endIdx);
          continue;
        }

        if (openIdx !== -1) {
          // 块边界处的未闭合开放标签：输出前面内容，进入块
          const preceding = buf.slice(0, openIdx);
          if (preceding) {
            const stripped = this.stripOrphanCloseTags(preceding);
            if (stripped) {
              out.push(stripped);
              this.lastEmittedEndedNewline = stripped.endsWith("\n");
            }
          }
          this.inBlock = true;
          buf = buf.slice(openIdx + openLen);
          continue;
        }

        // 没有可解析的标签结构：暂存尾部可能的部分标签，输出其余
        const heldOpen = this.maxPartialSuffix(buf, OPEN_TAGS);
        const heldClose = this.maxPartialSuffix(buf, CLOSE_TAGS);
        const held = Math.max(heldOpen, heldClose);

        let emitText: string;
        if (held > 0) {
          emitText = buf.slice(0, -held);
          this.buf = buf.slice(-held);
        } else {
          emitText = buf;
          this.buf = "";
        }

        if (emitText) {
          emitText = this.stripOrphanCloseTags(emitText);
          if (emitText) {
            out.push(emitText);
            this.lastEmittedEndedNewline = emitText.endsWith("\n");
          }
        }
        return out.join("");
      }
    }

    return out.join("");
  }

  /**
   * 流结束时刷新。
   * 如果仍在未闭合块内，暂存内容丢弃（泄露部分推理比截断答案更糟）。
   * 否则暂存的部分标签尾部原样输出（证明不是真实标签前缀）。
   */
  flush(): string {
    if (this.inBlock) {
      this.buf = "";
      this.inBlock = false;
      return "";
    }
    const tail = this.buf;
    this.buf = "";
    if (!tail) return "";
    const stripped = this.stripOrphanCloseTags(tail);
    if (stripped) {
      this.lastEmittedEndedNewline = stripped.endsWith("\n");
    }
    return stripped;
  }

  // ── 内部辅助方法 ───────────────────────────────────────────

  /** 查找最早的标签（不区分大小写），返回 [索引, 长度]，未找到返回 [-1, 0] */
  private findFirstTag(buf: string, tags: string[]): [number, number] {
    const bufLower = buf.toLowerCase();
    let bestIdx = -1;
    let bestLen = 0;
    for (const tag of tags) {
      const idx = bufLower.indexOf(tag.toLowerCase());
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
        bestLen = tag.length;
      }
    }
    return [bestIdx, bestLen];
  }

  /**
   * 查找最早的闭合对 <tag>...</tag>，返回 [startIdx, endIdx]，未找到返回 null。
   * 非贪婪匹配（开放标签后最近的关闭标签）。
   */
  private findEarliestClosedPair(buf: string): [number, number] | null {
    const bufLower = buf.toLowerCase();
    let best: [number, number] | null = null;

    for (let i = 0; i < OPEN_TAGS.length; i++) {
      const openTag = OPEN_TAGS[i].toLowerCase();
      const closeTag = CLOSE_TAGS[i].toLowerCase();
      const openIdx = bufLower.indexOf(openTag);
      if (openIdx === -1) continue;
      const closeIdx = bufLower.indexOf(closeTag, openIdx + openTag.length);
      if (closeIdx === -1) continue;
      const endIdx = closeIdx + closeTag.length;
      if (best === null || openIdx < best[0]) {
        best = [openIdx, endIdx];
      }
    }
    return best;
  }

  /**
   * 查找块边界处最早的开放标签，返回 [索引, 长度]，未找到返回 [-1, 0]。
   */
  private findOpenAtBoundary(buf: string, alreadyEmitted: string[]): [number, number] {
    const bufLower = buf.toLowerCase();
    let bestIdx = -1;
    let bestLen = 0;

    for (const tag of OPEN_TAGS) {
      const tagLower = tag.toLowerCase();
      let searchStart = 0;
      while (true) {
        const idx = bufLower.indexOf(tagLower, searchStart);
        if (idx === -1) break;
        if (this.isBlockBoundary(buf, idx, alreadyEmitted)) {
          if (bestIdx === -1 || idx < bestIdx) {
            bestIdx = idx;
            bestLen = tag.length;
          }
          break; // 这个标签的第一个边界命中就够了
        }
        searchStart = idx + 1;
      }
    }
    return [bestIdx, bestLen];
  }

  /**
   * 判断 buf 中 idx 位置是否是块边界。
   *
   * 块边界是：
   * - buf 位置 0 且上一次输出以换行结尾（或还没输出过）
   * - 任意位置，其当前行（自上次换行以来）前面只有空白，且
   *   如果 buf 前面部分没有换行，则上一次输出以换行结尾
   */
  private isBlockBoundary(buf: string, idx: number, alreadyEmitted: string[]): boolean {
    if (idx === 0) {
      // 检查本次 feed() 中已输出的最后一块是否以换行结尾，否则用跨 feed 标志
      if (alreadyEmitted.length > 0) {
        return alreadyEmitted[alreadyEmitted.length - 1].endsWith("\n");
      }
      return this.lastEmittedEndedNewline;
    }

    const preceding = buf.slice(0, idx);
    const lastNl = preceding.lastIndexOf("\n");

    if (lastNl === -1) {
      // buf 中标签前没有换行：只有当上一次输出以换行结尾，且此后都是空白时才是边界
      const priorNewline =
        alreadyEmitted.length > 0
          ? alreadyEmitted[alreadyEmitted.length - 1].endsWith("\n")
          : this.lastEmittedEndedNewline;
      return priorNewline && preceding.trim() === "";
    }

    // 有换行：换行和标签之间的文本必须只有空白
    return preceding.slice(lastNl + 1).trim() === "";
  }

  /**
   * 返回 buf 尾部中是任意标签前缀的最长长度。
   * 只有严格短于标签本身的前缀才算（完整长度的后缀就是标签本身，作为匹配处理）。
   */
  private maxPartialSuffix(buf: string, tags: string[]): number {
    if (!buf) return 0;
    const bufLower = buf.toLowerCase();
    const maxCheck = Math.min(bufLower.length, MAX_TAG_LEN - 1);
    for (let i = maxCheck; i > 0; i--) {
      const suffix = bufLower.slice(-i);
      for (const tag of tags) {
        const tagLower = tag.toLowerCase();
        if (tagLower.length > i && tagLower.startsWith(suffix)) {
          return i;
        }
      }
    }
    return 0;
  }

  /**
   * 移除文本中的孤立关闭标签（无匹配开放标签）。
   * 孤立关闭标签总是噪音，连同尾部空白一起移除，让周围文本自然流动。
   */
  private stripOrphanCloseTags(text: string): string {
    if (!text.includes("</")) return text;
    const textLower = text.toLowerCase();
    const out: string[] = [];
    let i = 0;

    while (i < text.length) {
      let matched = false;
      if (textLower.slice(i, i + 2) === "</") {
        for (const tag of CLOSE_TAGS) {
          const tagLower = tag.toLowerCase();
          const tagLen = tagLower.length;
          if (textLower.slice(i, i + tagLen) === tagLower) {
            // 跳过标签和尾部空白
            let j = i + tagLen;
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
        out.push(text[i]);
        i++;
      }
    }
    return out.join("");
  }
}

/**
 * 便捷函数：一次性清理完整字符串中的思维链标签（非流式场景）。
 * @param text 完整文本
 * @returns 清理后的文本
 */
export function scrubThinkBlocks(text: string): string {
  const scrubber = new StreamingThinkScrubber();
  const result = scrubber.feed(text);
  const tail = scrubber.flush();
  return result + tail;
}
