// checkpoint-manager.test.ts —— 文件系统快照 + 回滚（移植 Hermes checkpoint_manager）单测
//
// 覆盖：快照创建/去重/跳过、列表、diff、恢复（全量/单文件）、pre-rollback 快照、
// hash 校验、路径穿越校验、超大文件剔除、排除规则、getWorkingDirForPath、不可用目录降级。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CheckpointManager,
  formatCheckpointList,
  resolveCheckpointTarget,
} from "./checkpoint-manager";

// ── 测试仓库辅助 ──────────────────────────────────────

interface TestEnv {
  userData: string;
  workdir: string;
  manager: CheckpointManager;
}

function createEnv(options: { manager?: ConstructorParameters<typeof CheckpointManager>[1] } = {}): TestEnv {
  // os.tmpdir() 可能返回 8.3 短路径，realpathSync.native 展开为长路径，
  // 与产品侧 normalizePath 的规范化保持一致
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-cp-test-")));
  const userData = path.join(base, "userData");
  const workdir = path.join(base, "project");
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workdir, { recursive: true });
  const manager = new CheckpointManager(userData, options.manager);
  return { userData, workdir, manager };
}

/** 写文件并在下一次快照前调用 newTurn（模拟跨轮）。 */
async function checkpointAndEdit(
  env: TestEnv,
  write: (workdir: string) => void,
  reason = "test snapshot",
): Promise<boolean> {
  env.manager.newTurn();
  const taken = await env.manager.ensureCheckpoint(env.workdir, reason);
  write(env.workdir);
  return taken;
}

async function listHashes(env: TestEnv): Promise<string[]> {
  const list = await env.manager.listCheckpoints(env.workdir);
  return list.map((cp) => cp.hash);
}

function readFile(workdir: string, rel: string): string {
  return fs.readFileSync(path.join(workdir, rel), "utf8");
}

describe("CheckpointManager 基础快照", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = createEnv();
    // 空目录按设计跳过快照（Hermes 同语义：git add -A 空树无意义），测试先写一个初始文件
    fs.writeFileSync(path.join(env.workdir, "seed.txt"), "seed\n", "utf8");
  });
  afterEach(() => {
    fs.rmSync(path.dirname(env.userData), { recursive: true, force: true });
  });

  it("首次写入前打快照，并记录 reason", async () => {
    env.manager.newTurn();
    const taken = await env.manager.ensureCheckpoint(env.workdir, "before write_file main.ts");
    expect(taken).toBe(true);
    const list = await env.manager.listCheckpoints(env.workdir);
    expect(list.length).toBe(1);
    expect(list[0].reason).toBe("before write_file main.ts");
    expect(list[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(list[0].shortHash).toHaveLength(7);
  });

  it("同一 turn 内同一目录只打一张快照（去重）", async () => {
    const taken1 = await env.manager.ensureCheckpoint(env.workdir, "first");
    const taken2 = await env.manager.ensureCheckpoint(env.workdir, "second");
    expect(taken1).toBe(true);
    expect(taken2).toBe(false);
    expect((await env.manager.listCheckpoints(env.workdir)).length).toBe(1);
  });

  it("newTurn 后再次打快照", async () => {
    await env.manager.ensureCheckpoint(env.workdir, "first");
    fs.writeFileSync(path.join(env.workdir, "seed.txt"), "seed2\n", "utf8");
    env.manager.newTurn();
    const taken = await env.manager.ensureCheckpoint(env.workdir, "second");
    expect(taken).toBe(true);
    const list = await env.manager.listCheckpoints(env.workdir);
    expect(list.length).toBe(2);
  });

  it("无变化时跳过快照（不产生空快照）", async () => {
    env.manager.newTurn();
    await env.manager.ensureCheckpoint(env.workdir, "baseline");
    env.manager.newTurn();
    const taken = await env.manager.ensureCheckpoint(env.workdir, "no change");
    expect(taken).toBe(false);
    expect((await env.manager.listCheckpoints(env.workdir)).length).toBe(1);
  });

  it("enabled=false 时不打快照", async () => {
    const disabled = createEnv({ manager: { enabled: false } });
    try {
      const taken = await disabled.manager.ensureCheckpoint(disabled.workdir, "x");
      expect(taken).toBe(false);
      expect((await disabled.manager.listCheckpoints(disabled.workdir)).length).toBe(0);
    } finally {
      fs.rmSync(path.dirname(disabled.userData), { recursive: true, force: true });
    }
  });

  it("不存在的目录静默降级（不抛异常）", async () => {
    const missing = path.join(env.userData, "no-such-dir");
    const taken = await env.manager.ensureCheckpoint(missing, "x");
    expect(taken).toBe(false);
  });

  it("排除规则生效：node_modules 不纳入快照", async () => {
    fs.mkdirSync(path.join(env.workdir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(env.workdir, "node_modules", "big.js"), "console.log(1)\n", "utf8");
    fs.writeFileSync(path.join(env.workdir, "src.txt"), "hello\n", "utf8");
    env.manager.newTurn();
    await env.manager.ensureCheckpoint(env.workdir, "baseline");

    // 只改被排除的文件 → 无变化，跳过快照
    fs.writeFileSync(path.join(env.workdir, "node_modules", "big.js"), "changed\n", "utf8");
    env.manager.newTurn();
    const taken = await env.manager.ensureCheckpoint(env.workdir, "only-excluded-changed");
    expect(taken).toBe(false);

    // 改普通文件 → 有变化，打快照
    fs.writeFileSync(path.join(env.workdir, "src.txt"), "hello2\n", "utf8");
    env.manager.newTurn();
    const taken2 = await env.manager.ensureCheckpoint(env.workdir, "src-changed");
    expect(taken2).toBe(true);
  });

  it("超大文件（>maxFileSizeMb）从快照中剔除", async () => {
    const small = createEnv({ manager: { maxFileSizeMb: 1 } });
    try {
      const bigPath = path.join(small.workdir, "big.bin");
      fs.writeFileSync(bigPath, Buffer.alloc(2 * 1024 * 1024, 0x41));
      fs.writeFileSync(path.join(small.workdir, "code.ts"), "export const a = 1;\n", "utf8");
      small.manager.newTurn();
      await small.manager.ensureCheckpoint(small.workdir, "baseline");

      // 修改普通文件触发新快照，然后回滚到 baseline：code.ts 恢复但 big.bin 不受影响
      fs.writeFileSync(path.join(small.workdir, "code.ts"), "export const a = 2;\n", "utf8");
      small.manager.newTurn();
      await small.manager.ensureCheckpoint(small.workdir, "edit-code");

      const [edit, baseline] = await small.manager.listCheckpoints(small.workdir);
      expect(edit.reason).toBe("edit-code");
      expect(baseline.reason).toBe("baseline");
      const result = await small.manager.restore(small.workdir, baseline.hash);
      expect(result.success).toBe(true);
      expect(readFile(small.workdir, "code.ts")).toBe("export const a = 1;\n");
    } finally {
      fs.rmSync(path.dirname(small.userData), { recursive: true, force: true });
    }
  });

  it("超过 maxSnapshots 时自动修剪，只保留最近 N 张", { timeout: 120_000 }, async () => {
    const limited = createEnv({ manager: { maxSnapshots: 3 } });
    try {
      for (let i = 0; i < 4; i++) {
        limited.manager.newTurn();
        fs.writeFileSync(path.join(limited.workdir, `f${i}.txt`), `${i}\n`, "utf8");
        await limited.manager.ensureCheckpoint(limited.workdir, `step-${i}`);
      }
      const list = await limited.manager.listCheckpoints(limited.workdir);
      expect(list.length).toBeLessThanOrEqual(3);
    } finally {
      fs.rmSync(path.dirname(limited.userData), { recursive: true, force: true });
    }
  });
});

describe("CheckpointManager 回滚", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = createEnv();
    fs.writeFileSync(path.join(env.workdir, "a.txt"), "v1\n", "utf8");
    fs.writeFileSync(path.join(env.workdir, "b.txt"), "keep\n", "utf8");
  });
  afterEach(() => {
    fs.rmSync(path.dirname(env.userData), { recursive: true, force: true });
  });

  /** 先写入再打快照：让快照忠实反映该次写入后的状态。 */
  async function commit(writes: Record<string, string>, reason: string): Promise<void> {
    for (const [rel, content] of Object.entries(writes)) {
      fs.writeFileSync(path.join(env.workdir, rel), content, "utf8");
    }
    env.manager.newTurn();
    await env.manager.ensureCheckpoint(env.workdir, reason);
  }

  it("恢复到指定快照：被修改的文件还原，未涉及的文件不动", async () => {
    await commit({ "a.txt": "v1" }, "baseline");
    await commit({ "a.txt": "v2" }, "v2-edit");
    await commit({ "a.txt": "v3" }, "v3-edit");

    const [v3, v2, baseline] = await env.manager.listCheckpoints(env.workdir);
    expect(v3.reason).toBe("v3-edit");
    expect(v2.reason).toBe("v2-edit");
    expect(baseline.reason).toBe("baseline");

    const result = await env.manager.restore(env.workdir, v2.hash);
    expect(result.success).toBe(true);
    expect(result.restoredTo).toBe(v2.hash.slice(0, 8));
    expect(readFile(env.workdir, "a.txt")).toBe("v2");
    expect(readFile(env.workdir, "b.txt")).toBe("keep\n");
  });

  it("回滚前自动打 pre-rollback 快照（可撤销撤销）", async () => {
    await commit({ "a.txt": "v1" }, "baseline");
    // 回滚前留下未提交改动：pre-rollback 快照必须记录它，保证撤销可撤销
    env.manager.newTurn();
    fs.writeFileSync(path.join(env.workdir, "a.txt"), "v3\n", "utf8");

    const [baseline] = await env.manager.listCheckpoints(env.workdir);
    await env.manager.restore(env.workdir, baseline.hash);

    const list = await env.manager.listCheckpoints(env.workdir);
    expect(list[0].reason).toMatch(/^pre-rollback snapshot/);
    expect(list[0].reason).toContain(baseline.hash.slice(0, 8));
  });

  it("恢复单个文件（相对路径）", async () => {
    await commit({ "a.txt": "v1" }, "baseline");
    env.manager.newTurn();
    fs.writeFileSync(path.join(env.workdir, "a.txt"), "v3\n", "utf8");
    fs.writeFileSync(path.join(env.workdir, "b.txt"), "changed\n", "utf8");
    await env.manager.ensureCheckpoint(env.workdir, "both-changed");

    const [, baseline] = await env.manager.listCheckpoints(env.workdir);
    const result = await env.manager.restore(env.workdir, baseline.hash, "a.txt");
    expect(result.success).toBe(true);
    expect(result.file).toBe("a.txt");
    expect(readFile(env.workdir, "a.txt")).toBe("v1");
    // b.txt 保持现状（单文件恢复）
    expect(readFile(env.workdir, "b.txt")).toBe("changed\n");
  });

  it("diff 展示快照与当前工作树的差异", async () => {
    await commit({ "a.txt": "v1" }, "baseline");
    await commit({ "a.txt": "v3" }, "v3-edit");

    const [v3, baseline] = await env.manager.listCheckpoints(env.workdir);
    const diff = await env.manager.diff(env.workdir, baseline.hash);
    expect(diff.success).toBe(true);
    // git --stat 会缩写短文件名，用变更统计与 diff 全文断言
    expect(diff.stat).toContain("1 file changed");
    // baseline=v1 状态，当前工作树=v3 状态
    expect(diff.diff).toContain("a/a.txt");
    expect(diff.diff).toContain("-v1");
    expect(diff.diff).toContain("+v3");
  });

  it("不存在的快照 hash 返回明确错误", async () => {
    await env.manager.ensureCheckpoint(env.workdir, "x");
    const result = await env.manager.restore(env.workdir, "f".repeat(40));
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("非法 hash 拒绝（以 - 开头 / 非十六进制）", async () => {
    await env.manager.ensureCheckpoint(env.workdir, "x");
    const dash = await env.manager.restore(env.workdir, "--patch");
    expect(dash.success).toBe(false);
    expect(dash.error).toContain("must not start with '-'");
    const nonHex = await env.manager.restore(env.workdir, "zzzzzzzz");
    expect(nonHex.success).toBe(false);
    expect(nonHex.error).toContain("expected 4-64 hex characters");
  });

  it("单文件回滚拒绝绝对路径与目录穿越", async () => {
    await env.manager.ensureCheckpoint(env.workdir, "x");
    const abs = await env.manager.restore(env.workdir, "a".repeat(8), "C:\\Windows\\system32\\x");
    expect(abs.success).toBe(false);
    expect(abs.error).toContain("must be relative");
    const traversal = await env.manager.restore(env.workdir, "a".repeat(8), "../outside.txt");
    expect(traversal.success).toBe(false);
    expect(traversal.error).toContain("escapes");
  });

  it("删除的文件也能通过回滚恢复", async () => {
    await checkpointAndEdit(env, () => undefined, "baseline");
    // 跨轮删除文件
    env.manager.newTurn();
    fs.rmSync(path.join(env.workdir, "a.txt"));
    await env.manager.ensureCheckpoint(env.workdir, "deleted");

    const [, baseline] = await env.manager.listCheckpoints(env.workdir);
    const result = await env.manager.restore(env.workdir, baseline.hash);
    expect(result.success).toBe(true);
    expect(readFile(env.workdir, "a.txt")).toBe("v1\n");
  });
});

describe("CheckpointManager 工具函数", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = createEnv();
  });
  afterEach(() => {
    fs.rmSync(path.dirname(env.userData), { recursive: true, force: true });
  });

  it("getWorkingDirForPath 从子目录向上找到项目标记", async () => {
    // package.json 标记项目根
    fs.writeFileSync(path.join(env.workdir, "package.json"), "{}", "utf8");
    const sub = path.join(env.workdir, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });
    expect(env.manager.getWorkingDirForPath(path.join(sub, "file.ts"))).toBe(env.workdir);
    // 无标记时返回文件所在目录
    const noMark = path.join(env.userData, "plain");
    fs.mkdirSync(noMark, { recursive: true });
    expect(env.manager.getWorkingDirForPath(path.join(noMark, "x.txt"))).toBe(noMark);
  });

  it("resolveCheckpointTarget 支持序号与短 hash", async () => {
    fs.writeFileSync(path.join(env.workdir, "a.txt"), "1\n", "utf8");
    env.manager.newTurn();
    await env.manager.ensureCheckpoint(env.workdir, "first");
    env.manager.newTurn();
    fs.writeFileSync(path.join(env.workdir, "a.txt"), "2\n", "utf8");
    await env.manager.ensureCheckpoint(env.workdir, "second");

    const list = await env.manager.listCheckpoints(env.workdir);
    expect(resolveCheckpointTarget(list, "1")).toBe(list[0].hash);
    expect(resolveCheckpointTarget(list, "2")).toBe(list[1].hash);
    expect(resolveCheckpointTarget(list, list[0].shortHash)).toBe(list[0].hash);
    expect(resolveCheckpointTarget(list, "99")).toBeNull();
    expect(resolveCheckpointTarget(list, "zzz")).toBeNull();
  });

  it("formatCheckpointList 输出用户可读列表与用法提示", async () => {
    fs.writeFileSync(path.join(env.workdir, "a.txt"), "1\n", "utf8");
    env.manager.newTurn();
    await env.manager.ensureCheckpoint(env.workdir, "init");

    const text = formatCheckpointList(await env.manager.listCheckpoints(env.workdir), env.workdir);
    expect(text).toContain(env.workdir);
    expect(text).toContain("/rollback");
    expect(text).toContain("init");

    const empty = formatCheckpointList([], env.workdir);
    expect(empty).toContain("还没有可回滚的快照");
  });

  it("空目录列表返回空数组", async () => {
    expect(await env.manager.listCheckpoints(env.workdir)).toEqual([]);
  });
});
