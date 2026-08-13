/**
 * 服务自动启动器
 *
 * 后端服务（TTS 本地引擎等）由 Rust 端 `service.rs` 管理，前端通过管理后台的
 * HTTP 接口启动：POST http://127.0.0.1:9876/api/service/start
 *    body: { id, command, args: string[], workDir, port }
 *
 * 这里封装「注册 provider 后自动拉起对应后端」的逻辑，让向导实现
 * “填完关键信息 + 选好权重位置 → 直接运行起来”的体验。
 */

const ADMIN_PORT = 9876;

export interface ServiceLaunchSpec {
  id: string;
  command: string;
  args: string[];
  workDir: string;
  port: number;
}

/** 各 TTS 引擎的后端启动规格（基于应用根目录的相对路径）。
 *  venv 为 desk-pet 共享 Python 环境。cosyvoice 因依赖独立的 torch/cosyvoice
 *  环境，启动能否成功取决于该 venv 是否就绪——属已知 caveat，启动失败仅提示不阻断。 */
export const TTS_LAUNCH_SPECS: Record<string, ServiceLaunchSpec> = {
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

/**
 * 启动指定类型的 TTS 后端。
 * @returns true 表示管理后台返回 ok（已发起启动），false 表示失败或该类型无启动规格。
 */
export async function startTTSBackend(typeName: string): Promise<boolean> {
  const spec = TTS_LAUNCH_SPECS[typeName];
  if (!spec) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${ADMIN_PORT}/api/service/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    });
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data?.ok);
  } catch (err) {
    console.warn('[startTTSBackend] 启动请求失败:', err);
    return false;
  }
}
