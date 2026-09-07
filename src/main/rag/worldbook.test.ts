import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WorldbookManager, type WorldbookEntry } from "./worldbook";

// worldbook.ts 的模块链会引入 ../logger（依赖 electron.app.getPath），
// 与 index.test.ts 采用同一套 electron mock。
const { userDataDir } = vi.hoisted(() => ({ userDataDir: { value: "" } }));

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir.value,
    getAppPath: () => userDataDir.value,
  },
}));

function makeEntry(id: string, keywords: string[], intrinsicValue = 60): WorldbookEntry {
  return {
    id,
    keywords,
    content: "设定内容 " + id,
    priority: 5,
    permanent: false,
    enabled: true,
    intrinsicValue,
    linkTriggers: [],
  };
}

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "worldbook-test-"));
  userDataDir.value = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("WorldbookManager DMAE 状态持久化", () => {
  it("updateActivation 后写入 stateFile，重建实例后恢复状态", () => {
    const stateFile = path.join(tmpDir, "worldbook-state.json");
    const mgr = new WorldbookManager("", { stateFile, debug: false });
    const entries = [makeEntry("wb_a_alpha", ["星空"]), makeEntry("wb_b_beta", ["山谷"])];
    mgr.loadFromEntries(entries);

    mgr.updateActivation("星空", "", 0);
    mgr.updateActivation("星空", "", 1);

    // 落盘
    expect(fs.existsSync(stateFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Array<{
      id: string;
      state: { activation: number };
    }>;
    const alphaSaved = saved.find((s) => s.id === "wb_a_alpha");
    expect(alphaSaved).toBeDefined();
    expect(alphaSaved!.state.activation).toBeGreaterThan(0);

    // 模拟重启：新实例 + 同一 stateFile
    const restored = new WorldbookManager("", { stateFile, debug: false });
    restored.loadFromEntries(entries);
    const st = restored.getState("wb_a_alpha");
    expect(st).toBeDefined();
    expect(st!.activation).toBeCloseTo(alphaSaved!.state.activation, 5);
  });

  it("未配置 stateFile 时不持久化（重建实例后状态归零）", () => {
    const entries = [makeEntry("wb_a_alpha", ["星空"])];
    const mgr = new WorldbookManager("", { debug: false });
    mgr.loadFromEntries(entries);
    mgr.updateActivation("星空", "", 0);
    expect(mgr.getState("wb_a_alpha")!.activation).toBeGreaterThan(0);

    const fresh = new WorldbookManager("", { debug: false });
    fresh.loadFromEntries(entries);
    expect(fresh.getState("wb_a_alpha")!.activation).toBe(0);
  });

  it("stateFile 中未知条目被跳过、非法值被归一化", () => {
    const stateFile = path.join(tmpDir, "worldbook-state.json");
    fs.writeFileSync(
      stateFile,
      JSON.stringify([
        { id: "wb_a_alpha", state: { activation: 500, userSilence: -3, modelSilence: 2.9, recentUserHits: [0, 1, "x", -5] } },
        { id: "wb_deleted_gone", state: { activation: 42, userSilence: 1, modelSilence: 0, recentUserHits: [] } },
        { id: "wb_b_beta", state: { activation: "not-a-number", userSilence: 0, modelSilence: 0, recentUserHits: [] } },
      ]),
      "utf8",
    );

    const mgr = new WorldbookManager("", { stateFile, debug: false });
    const entries = [makeEntry("wb_a_alpha", ["星空"]), makeEntry("wb_b_beta", ["山谷"])];
    mgr.loadFromEntries(entries);

    const alpha = mgr.getState("wb_a_alpha")!;
    expect(alpha.activation).toBe(100); // clamp 到 maxScore
    expect(alpha.userSilence).toBe(0);  // 负数 clamp 到 0
    expect(alpha.modelSilence).toBe(2); // 小数 floor
    expect(alpha.recentUserHits).toEqual([0, 1]); // 过滤非数字 / 负数

    // 已从 worldbook 删除的条目不恢复
    expect(mgr.getState("wb_deleted_gone")).toBeUndefined();

    // activation 非法（非 number）→ 整条跳过，保持默认 0
    expect(mgr.getState("wb_b_beta")!.activation).toBe(0);
  });

  it("loadFromDirectory 真实 .md 加载后，重载恢复持久化状态", async () => {
    const wbDir = path.join(tmpDir, "worldbook");
    fs.mkdirSync(wbDir);
    fs.writeFileSync(path.join(wbDir, "a.md"), "## Alpha\n- 触发词: 星空\n- 内在价值: 60\n\n星空相关设定。\n---\n", "utf8");
    const stateFile = path.join(tmpDir, "worldbook-state.json");

    const mgr = new WorldbookManager(wbDir, { stateFile, debug: false });
    await mgr.loadFromDirectory();
    mgr.updateActivation("星空", "", 0);
    const id = "wb_a_Alpha";
    expect(mgr.getState(id)!.activation).toBeGreaterThan(0);

    const restored = new WorldbookManager(wbDir, { stateFile, debug: false });
    await restored.loadFromDirectory();
    expect(restored.getState(id)!.activation).toBeGreaterThan(0);
  });
});
