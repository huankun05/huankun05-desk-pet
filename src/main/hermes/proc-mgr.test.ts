import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";

/**
 * proc-mgr 崩溃自愈（watchdog）单测。
 *
 * 依赖注入 seam（__setProcMgrDepsForTest）：sleep 立即返回、pingHealth
 * 按脚本应答、退避档位压缩到毫秒级、定时器可捕获不触发；spawn 用假
 * ChildProcess（EventEmitter）模拟退出；hermes-settings 整体 mock。
 */

/** 可变设置：用例内可改 autoStartGateway */
const currentSettings = {
  sourceDir: "C:/fake/hermes-agent",
  homeDir: "C:/fake/hermes-home",
  uvPath: "uv",
  apiPort: 8642,
  apiHost: "127.0.1.1",
  apiServerKey: "k",
  autoStartGateway: true,
  syncModelCredentials: true,
  defaultModel: "",
  modelProvider: "",
};

vi.mock("electron", () => ({
  app: { getPath: () => "C:/fake/userdata", getAppPath: () => "C:/fake/app" },
}));

vi.mock("./hermes-settings", () => ({
  loadHermesSettings: () => currentSettings,
  resolveEffectiveHermesSettings: <T>(s: T) => s,
  writeHermesRuntimeEnv: () => ({ envPath: "", ok: true }),
  discoverHermesSourceDir: () => currentSettings.sourceDir,
  discoverHermesHome: () => currentSettings.homeDir,
  discoverUvPath: () => "uv",
}));

// 假 fs：仅 cli.py 判定需要命中，其余透传真实实现
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: (p: string) => String(p).endsWith("cli.py") };
});

/** 可编程假子进程：exit(code) 触发 exit 监听 */
function makeFakeChild(): ChildProcess & { exit(code?: number): void } {
  const emitter = new EventEmitter() as ChildProcess & { exit(code?: number): void };
  Object.defineProperty(emitter, "exitCode", { value: null, writable: true });
  Object.defineProperty(emitter, "killed", { value: false, writable: true });
  emitter.exit = (code?: number) => {
    (emitter as unknown as { exitCode: number | null }).exitCode = code ?? 0;
    emitter.emit("exit", code ?? 0);
  };
  (emitter as unknown as { kill: () => boolean }).kill = vi.fn(() => {
    (emitter as unknown as { killed: boolean }).killed = true;
    return true;
  });
  return emitter;
}

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import {
  __resetProcMgrDepsForTest,
  __setProcMgrDepsForTest,
  ensureAiEngineRunning,
  getAiEngineStatus,
  restartAiEngine,
  stopAiEngine,
} from "./proc-mgr";

/** ping 按脚本依次应答，脚本耗尽后重复最后一项 */
function pingScript(results: boolean[]) {
  let i = 0;
  return () => {
    const v = results[Math.min(i, results.length - 1)];
    i += 1;
    return Promise.resolve(v);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  spawnMock.mockImplementation(() => makeFakeChild());
  __resetProcMgrDepsForTest();
  // 人工停止：复位 stopping/退避/定时器
  stopAiEngine();
  currentSettings.autoStartGateway = true;
});

describe("proc-mgr 崩溃自愈（watchdog）", () => {
  it("gateway 意外退出后按退避自动重启并恢复健康", async () => {
    __setProcMgrDepsForTest({
      sleep: () => Promise.resolve(),
      pingHealth: pingScript([false, true]),
      backoffMs: [5, 5, 5],
      healthWaitPolls: 1,
    });
    const status = await ensureAiEngineRunning();
    expect(status.healthy).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 退出 → 5ms 后 respawn：探测 ping 失败（确认已死）→ 重新 spawn → health 轮询成功
    const first = spawnMock.mock.results[0]?.value as ChildProcess & { exit(c?: number): void };
    __setProcMgrDepsForTest({ pingHealth: pingScript([false, true]) });
    first.exit(1);
    await new Promise((r) => setTimeout(r, 50));

    expect(spawnMock.mock.calls.length).toBe(2);
    const after = await getAiEngineStatus();
    expect(after.restarts).toBe(1);
  });

  it("连续失败时退避档位递增且不超过封顶", async () => {
    const seenDelays: number[] = [];
    const fired: Array<() => void> = [];
    __setProcMgrDepsForTest({
      sleep: () => Promise.resolve(),
      pingHealth: () => Promise.resolve(false),
      backoffMs: [10, 20, 40],
      healthWaitPolls: 0,
      // 定时器只记录不触发：隔离 respawn 链，纯验证档位推进
      schedule: (fn, delayMs) => {
        seenDelays.push(delayMs);
        fired.push(fn);
        return { clear: () => {} };
      },
    });
    await ensureAiEngineRunning();
    const child = spawnMock.mock.results[0]?.value as ChildProcess & { exit(c?: number): void };
    // 连续四次意外退出：退避 10 → 20 → 40 → 40（封顶）
    child.exit(1);
    child.exit(1);
    child.exit(1);
    child.exit(1);
    expect(seenDelays).toEqual([10, 20, 40, 40]);
  });

  it("恢复健康后退避档位归零", async () => {
    __setProcMgrDepsForTest({
      sleep: () => Promise.resolve(),
      pingHealth: pingScript([false, true]),
      backoffMs: [10, 20, 40],
      healthWaitPolls: 1,
    });
    await ensureAiEngineRunning();
    // 让 respawn 完整跑一轮且 health 成功 → backoffIndex 归零
    const first = spawnMock.mock.results[0]?.value as ChildProcess & { exit(c?: number): void };
    __setProcMgrDepsForTest({ pingHealth: pingScript([false, true]) });
    first.exit(1);
    await new Promise((r) => setTimeout(r, 50));

    // 再次退出：应从最小退避 10ms 重新开始
    const seen: number[] = [];
    __setProcMgrDepsForTest({
      schedule: (fn, delayMs) => {
        seen.push(delayMs);
        return { clear: () => {} };
      },
    });
    const second = spawnMock.mock.results[1]?.value as ChildProcess & { exit(c?: number): void };
    second.exit(1);
    expect(seen).toEqual([10]);
  });

  it("stopAiEngine 后进程退出不触发自愈", async () => {
    __setProcMgrDepsForTest({
      sleep: () => Promise.resolve(),
      pingHealth: pingScript([false, true]),
      backoffMs: [5, 5, 5],
      healthWaitPolls: 1,
    });
    await ensureAiEngineRunning();
    const callsBefore = spawnMock.mock.calls.length;
    stopAiEngine();
    const child = spawnMock.mock.results[0]?.value as ChildProcess & { exit(c?: number): void };
    child.exit(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(spawnMock.mock.calls.length).toBe(callsBefore);
  });

  it("自愈时端口已被接管（health 可用）则不重复 spawn", async () => {
    __setProcMgrDepsForTest({
      sleep: () => Promise.resolve(),
      pingHealth: pingScript([false, true]),
      backoffMs: [5, 5, 5],
      healthWaitPolls: 1,
    });
    await ensureAiEngineRunning();
    const callsBefore = spawnMock.mock.calls.length;
    const restartsBefore = (await getAiEngineStatus()).restarts ?? 0;
    __setProcMgrDepsForTest({ pingHealth: pingScript([true]) });
    const child = spawnMock.mock.results[0]?.value as ChildProcess & { exit(c?: number): void };
    child.exit(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(spawnMock.mock.calls.length).toBe(callsBefore);
    const status = await getAiEngineStatus();
    expect(status.restarts).toBe(restartsBefore + 1);
  });

  it("restartAiEngine：人工重启停旧实例并重新拉起，不触发额外自愈", async () => {
    __setProcMgrDepsForTest({
      sleep: () => Promise.resolve(),
      // ensure#1: ping+poll；getAiEngineStatus 探测；restart: ping 失败 → 重新 spawn → poll 成功
      pingHealth: pingScript([false, true, false, false, true]),
      backoffMs: [5, 5, 5],
      healthWaitPolls: 1,
    });
    await ensureAiEngineRunning();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const first = spawnMock.mock.results[0]?.value as ChildProcess & { kill: () => boolean };
    const restartsBefore = (await getAiEngineStatus()).restarts ?? 0;

    const status = await restartAiEngine();
    expect(status.healthy).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(first.kill).toHaveBeenCalledTimes(1);
    // 人工重启路径不产生自愈计数（计数为会话累计，只看增量）
    expect(status.restarts).toBe(restartsBefore);
  });

  it("autoStartGateway=false 时 ensure 短路不拉起", async () => {
    currentSettings.autoStartGateway = false;
    __setProcMgrDepsForTest({
      sleep: () => Promise.resolve(),
      pingHealth: pingScript([false]),
      backoffMs: [5, 5, 5],
      healthWaitPolls: 1,
    });
    const status = await ensureAiEngineRunning();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(status.detail).toBe("已关闭自动启动");
  });
});
