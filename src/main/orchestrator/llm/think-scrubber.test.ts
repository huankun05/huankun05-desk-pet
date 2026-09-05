// think-scrubber.test.ts — 流式思维链清理器单元测试
//
// 测试覆盖：
// 1. 完整闭合对 <think>...</think> 移除
// 2. 流式 delta 分割的思维链移除
// 3. 块边界规则（行首才视为开放标签）
// 4. 部分标签跨 delta 暂存
// 5. 孤立关闭标签移除
// 6. 多种标签变体（thinking/reasoning/thought/REASONING_SCRATCHPAD）
// 7. 不区分大小写
// 8. flush 行为
// 9. reset 行为
// 10. 普通文本不受影响
// 11. scrubThinkBlocks 便捷函数

import { describe, it, expect } from "vitest";
import { StreamingThinkScrubber, scrubThinkBlocks } from "./think-scrubber";

describe("StreamingThinkScrubber: 完整闭合对移除", () => {
  it("移除 <think>...</think> 闭合对", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>推理内容</think>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("移除中间有闭合对的文本", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("前面<think>推理</think>后面")).toBe("前面后面");
    expect(s.flush()).toBe("");
  });

  it("移除多个闭合对", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>A</think>1<think>B</think>2")).toBe("12");
    expect(s.flush()).toBe("");
  });

  it("空思维链闭合对也移除", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think></think>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: 流式 delta 分割", () => {
  it("delta 分割的思维链正确移除", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>")).toBe("");
    expect(s.feed("推理内容")).toBe("");
    expect(s.feed("</think>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("delta 分割在标签中间", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<th")).toBe("");
    expect(s.feed("ink>推理</think>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("delta 分割在关闭标签中间", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>推理</th")).toBe("");
    expect(s.feed("ink>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("思维链后还有普通文本", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>推理")).toBe("");
    expect(s.feed("内容</think>这是回答")).toBe("这是回答");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: 块边界规则", () => {
  it("行首的 <think> 视为开放标签", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>推理</think>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("换行后的 <think> 视为开放标签", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("前面\n<think>推理</think>后面")).toBe("前面\n后面");
    expect(s.flush()).toBe("");
  });

  it("行中间的 <think> 不视为开放标签（但闭合对仍移除）", () => {
    // 闭合对总是移除，无论边界
    const s = new StreamingThinkScrubber();
    expect(s.feed("使用 <think> 标签</think> 这里")).toBe("使用  这里");
    expect(s.flush()).toBe("");
  });

  it("行中间的未闭合 <think> 不移除", () => {
    const s = new StreamingThinkScrubber();
    // 行中间的未闭合开放标签不被视为思维链开始
    expect(s.feed("提到 <think> 标签")).toBe("提到 <think> 标签");
    expect(s.flush()).toBe("");
  });

  it("空白后的 <think> 视为开放标签（未闭合）", () => {
    const s = new StreamingThinkScrubber();
    // 空白后的未闭合开放标签视为块边界，进入思维链块
    // 前面的空白保留输出，思维链内容被丢弃
    expect(s.feed("  <think>推理内容")).toBe("  ");
    expect(s.flush()).toBe(""); // 未闭合块内容丢弃
  });

  it("闭合对前的空白保留", () => {
    const s = new StreamingThinkScrubber();
    // 闭合对总是移除，但前面的空白保留
    expect(s.feed("  <think>推理</think>回答")).toBe("  回答");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: 部分标签暂存", () => {
  it("尾部的部分开放标签被暂存", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("回答<th")).toBe("回答");
    expect(s.feed("ink>推理</think>更多")).toBe("更多");
    expect(s.flush()).toBe("");
  });

  it("尾部的部分关闭标签被暂存", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>推理</th")).toBe("");
    expect(s.feed("ink>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("flush 时暂存的非标签内容被输出", () => {
    const s = new StreamingThinkScrubber();
    // "<thi" 不是完整标签，flush 时应该输出
    expect(s.feed("回答<thi")).toBe("回答");
    expect(s.flush()).toBe("<thi");
  });
});

describe("StreamingThinkScrubber: 孤立关闭标签移除", () => {
  it("移除孤立的 </think> 标签", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("前面</think>后面")).toBe("前面后面");
    expect(s.flush()).toBe("");
  });

  it("移除孤立关闭标签和尾部空白", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("前面 </think> 后面")).toBe("前面 后面");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: 多种标签变体", () => {
  it("移除 <thinking>...</thinking>", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<thinking>推理</thinking>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("移除 <reasoning>...</reasoning>", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<reasoning>推理</reasoning>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("移除 <thought>...</thought>", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<thought>推理</thought>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("移除 <REASONING_SCRATCHPAD>...</REASONING_SCRATCHPAD>", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<REASONING_SCRATCHPAD>推理</REASONING_SCRATCHPAD>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: 不区分大小写", () => {
  it("大写 <THINK> 也被移除", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<THINK>推理</THINK>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("混合大小写 <Think> 也被移除", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<Think>推理</ThInK>回答")).toBe("回答");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: flush 行为", () => {
  it("未闭合块在 flush 时丢弃内容", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>未闭合的推理")).toBe("");
    expect(s.flush()).toBe(""); // 未闭合块内容丢弃
  });

  it("flush 后状态重置", () => {
    const s = new StreamingThinkScrubber();
    s.feed("<think>推理");
    s.flush();
    // flush 后应该可以正常处理新文本
    expect(s.feed("新回答")).toBe("新回答");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: reset 行为", () => {
  it("reset 后状态清空", () => {
    const s = new StreamingThinkScrubber();
    s.feed("<think>推理");
    s.reset();
    // reset 后应该可以正常处理新文本
    expect(s.feed("新回答")).toBe("新回答");
    expect(s.flush()).toBe("");
  });

  it("新实例初始状态正确", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("普通文本")).toBe("普通文本");
    expect(s.flush()).toBe("");
  });
});

describe("StreamingThinkScrubber: 普通文本不受影响", () => {
  it("纯普通文本原样输出", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("这是一段普通文本，没有思维链标签。")).toBe("这是一段普通文本，没有思维链标签。");
    expect(s.flush()).toBe("");
  });

  it("包含尖括号但不是标签的文本不受影响", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("使用 <div> 标签和 <span> 标签")).toBe("使用 <div> 标签和 <span> 标签");
    expect(s.flush()).toBe("");
  });

  it("空字符串输入返回空", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("")).toBe("");
    expect(s.flush()).toBe("");
  });
});

describe("scrubThinkBlocks: 便捷函数", () => {
  it("一次性清理完整字符串", () => {
    expect(scrubThinkBlocks("<think>推理</think>回答")).toBe("回答");
  });

  it("清理多个思维链", () => {
    expect(scrubThinkBlocks("<think>A</think>1<think>B</think>2")).toBe("12");
  });

  it("普通文本原样返回", () => {
    expect(scrubThinkBlocks("普通文本")).toBe("普通文本");
  });

  it("未闭合思维链不影响后面的文本", () => {
    // 未闭合的 <think> 在行首会被视为开放标签，后面的内容会被丢弃
    expect(scrubThinkBlocks("<think>未闭合推理回答")).toBe("");
  });
});

describe("StreamingThinkScrubber: 复杂场景", () => {
  it("思维链和普通文本交替", () => {
    const s = new StreamingThinkScrubber();
    let result = "";
    result += s.feed("开始\n");
    result += s.feed("<think>第一步推理</think>\n");
    result += s.feed("中间内容\n");
    result += s.feed("<think>第二步推理</think>\n");
    result += s.feed("结束");
    result += s.flush();
    expect(result).toBe("开始\n\n中间内容\n\n结束");
  });

  it("多行思维链内容", () => {
    const s = new StreamingThinkScrubber();
    const thinkContent = "<think>\n第一行推理\n第二行推理\n第三行推理\n</think>回答";
    expect(s.feed(thinkContent)).toBe("回答");
    expect(s.flush()).toBe("");
  });

  it("思维链中包含类似标签的文本", () => {
    const s = new StreamingThinkScrubber();
    expect(s.feed("<think>提到 </think> 标签</think>回答")).toBe(" 标签回答");
    expect(s.flush()).toBe("");
  });
});
