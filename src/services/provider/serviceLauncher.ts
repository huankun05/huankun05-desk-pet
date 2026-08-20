/**
 * 服务自动启动器
 *
 * 后端服务（TTS 本地引擎等）由 Rust 端 `service.rs` 管理，前端通过 Tauri 命令
 * 直接调起（不再经过管理后台 HTTP 服务 / 端口 9876）：
 *   invoke('service_start', { id, command, args, workDir, port })  → 启动
 *   invoke('service_stop', { id })                                → 停止
 *
 * 这里封装「注册 provider 后自动拉起对应后端」的逻辑，让向导实现
 * “填完关键信息 → 直接运行起来”的体验。
 *
 * 启动规格优先取自 provider 自身携带的 `launch`（用户在向导里填的 Python/命令/端口），
 * 这样每个模型都能用自己合适的环境；缺失时回退到下方的默认映射。
 */

import type { ServiceLaunchSpec } from './types';
import { invoke } from '@tauri-apps/api/core';

/** 解析后的启动规格（带服务 id，用于 POST 给管理后台）。 */
interface ResolvedLaunchSpec extends ServiceLaunchSpec {
  id: string;
}

/** 各 TTS 引擎的默认启动规格（仅在没有显式 launch 时作为回退）。 */
export const TTS_LAUNCH_SPECS: Record<string, ResolvedLaunchSpec> = {
  edge_tts: {
    id: 'service_8001',
    command: 'venv/Scripts/python.exe',
    args: ['server/edge_tts_server.py', '--port', '8001'],
    workDir: '.',
    port: 8001,
  },
  gpt_sovits: {
    id: 'service_9880',
    command: 'venv/Scripts/python.exe',
    args: ['server/gpt_sovits_server.py', '--port', '9880'],
    workDir: '.',
    port: 9880,
  },
  cosyvoice: {
    id: 'service_8003',
    command: 'venv/Scripts/python.exe',
    args: ['server/cosyvoice_server.py', '--port', '8003'],
    workDir: '.',
    port: 8003,
  },
};

export const STT_LAUNCH_SPECS: Record<string, ResolvedLaunchSpec> = {
  funasr: {
    id: 'service_8002',
    command: 'venv/Scripts/python.exe',
    args: ['server/stt_server.py', '--port', '8002'],
    workDir: '.',
    port: 8002,
  },
  sensevoice: {
    id: 'service_8002',
    command: 'venv/Scripts/python.exe',
    args: ['server/stt_server.py', '--port', '8002'],
    workDir: '.',
    port: 8002,
  },
  sherpaonnx: {
    id: 'service_8002',
    command: 'venv/Scripts/python.exe',
    args: ['server/stt_server.py', '--port', '8002'],
    workDir: '.',
    port: 8002,
  },
};

/** 把 provider 配置解析成启动规格（优先 launch，回退默认映射）。 */
export function resolveLaunchSpec(
  typeName: string,
  launch?: ServiceLaunchSpec,
): ResolvedLaunchSpec | null {
  if (launch && launch.command) {
    const port = launch.port ?? TTS_LAUNCH_SPECS[typeName]?.port ?? 0;
    return {
      id: `service_${port || typeName}`,
      command: launch.command,
      args: launch.args ?? [],
      workDir: launch.workDir ?? '.',
      port,
      env: launch.env,
    };
  }
  const def = TTS_LAUNCH_SPECS[typeName] || STT_LAUNCH_SPECS[typeName];
  return def ? { ...def } : null;
}

/**
 * 按 provider 配置启动其后端（自定义模型也能用——只要填了 launch）。
 * @returns true 表示管理后台返回 ok（已发起启动）。
 */
export async function startProviderService(
  typeName: string,
  launch?: ServiceLaunchSpec,
): Promise<boolean> {
  const spec = resolveLaunchSpec(typeName, launch);
  if (!spec) return false;
  try {
    await invoke('service_start', {
      id: spec.id,
      command: spec.command,
      args: spec.args,
      workDir: spec.workDir,
      port: spec.port,
    });
    return true;
  } catch (err) {
    console.warn('[startProviderService] 启动请求失败:', err);
    return false;
  }
}

/**
 * @deprecated 兼容旧调用：仅按类型名启动。
 */
export async function startTTSBackend(typeName: string): Promise<boolean> {
  return startProviderService(typeName);
}

/** 按服务 id（形如 service_<port>）停止后端，用于热插拔时卸载旧引擎。 */
export async function stopProviderServiceById(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    await invoke('service_stop', { id });
    return true;
  } catch (err) {
    console.warn('[stopProviderService] 停止请求失败:', err);
    return false;
  }
}

/** 按 provider 配置停止其后端（解析出 id 后委托 stopProviderServiceById）。 */
export async function stopProviderService(
  typeName: string,
  launch?: ServiceLaunchSpec,
): Promise<boolean> {
  const spec = resolveLaunchSpec(typeName, launch);
  if (!spec) return false;
  return stopProviderServiceById(spec.id);
}
