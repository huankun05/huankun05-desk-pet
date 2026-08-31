/**
 * StatusPage — 本地服务运行状态与手动管理（启动 / 停止 / 重启）
 *
 * 背景：语音服务（TTS/STT）在应用启动时由 lifecycle.bootstrapAll() 拉起，
 * 但可能因启动慢、崩溃或手动停止而未运行，且此前设置页没有手动管理入口。
 * 本页：
 *  - 列出当前活跃的本地 TTS / STT 引擎（按 active provider 配置解析端口）
 *  - 同时展示 Hermes Gateway / Core API 两个核心服务的只读状态
 *  - 每个服务实时 TCP 探测状态（3s 轮询），支持启动 / 停止 / 重启
 * 操作经 lifecycle（service_stop / service_launch Rust 命令）真正启停进程。
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { Section, useToast } from '../../components';
import { providerManager } from '../../../services/provider/manager';
import { resolveLaunchSpec } from '../../../services/provider/serviceLauncher';
import { lifecycle } from '../../../services/provider/serviceLifecycle';
import { isTauriEnv } from '../../../utils/tauriEnv';

interface ServiceEntry {
  key: string;
  /** 显示名（优先用 provider 配置名） */
  name: string;
  kind: 'tts' | 'stt' | 'gateway' | 'core';
  /** 启动用 typeName（核心服务无，由 Rust 侧管理） */
  typeName?: string;
  port: number;
  /** 核心服务：仅显示状态，不提供启停（避免弄挂应用主干） */
  core?: boolean;
}

type RunStatus = 'running' | 'stopped' | 'starting' | 'stopping';

/** 收集当前活跃的本地服务条目（TTS/STT 引擎 + 两个核心服务） */
function collectServices(): ServiceEntry[] {
  const entries: ServiceEntry[] = [];

  const tts = providerManager.getActiveTTSConfig();
  if (tts) {
    const spec = resolveLaunchSpec(tts.typeName, tts.launch);
    if (spec?.port) {
      entries.push({
        key: 'tts',
        name: tts.name || tts.typeName,
        kind: 'tts',
        typeName: tts.typeName,
        port: spec.port,
      });
    }
  }

  const stt = providerManager.getActiveSTTConfig();
  if (stt) {
    const spec = resolveLaunchSpec(stt.typeName, stt.launch);
    if (spec?.port) {
      entries.push({
        key: 'stt',
        name: stt.name || stt.typeName,
        kind: 'stt',
        typeName: stt.typeName,
        port: spec.port,
      });
    }
  }

  // 核心服务（只读状态）
  entries.push({ key: 'gateway', name: 'Hermes Gateway', kind: 'gateway', port: 8765, core: true });
  entries.push({ key: 'core', name: 'Core API', kind: 'core', port: 9877, core: true });

  return entries;
}

const STATUS_META: Record<RunStatus, { label: string; color: string; dot: string }> = {
  running: { label: '运行中', color: 'text-emerald-500', dot: '#34d399' },
  stopped: { label: '未运行', color: 'text-neutral-400', dot: '#9ca3af' },
  starting: { label: '启动中…', color: 'text-amber-500', dot: '#fbbf24' },
  stopping: { label: '停止中…', color: 'text-amber-500', dot: '#fbbf24' },
};

export function StatusPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [services] = useState<ServiceEntry[]>(collectServices);
  const [status, setStatus] = useState<Record<string, RunStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const probe = useCallback(async (port: number): Promise<boolean> => {
    if (!isTauriEnv()) return false;
    try {
      return await invoke<boolean>('check_tcp_health', { port });
    } catch {
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    const next: Record<string, RunStatus> = {};
    for (const svc of services) {
      const healthy = await probe(svc.port);
      next[svc.key] = healthy ? 'running' : 'stopped';
    }
    setStatus((prev) => {
      // 进行中的操作状态（starting/stopping）不被动刷新覆盖
      const merged: Record<string, RunStatus> = { ...prev };
      for (const k of Object.keys(next)) {
        if (merged[k] !== 'starting' && merged[k] !== 'stopping') merged[k] = next[k];
      }
      return merged;
    });
  }, [services, probe]);

  useEffect(() => {
    const t0 = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      clearTimeout(t0);
      clearInterval(timer);
    };
  }, [refresh]);

  const setOne = (key: string, s: RunStatus) => setStatus((prev) => ({ ...prev, [key]: s }));

  const run = async (svc: ServiceEntry, action: 'start' | 'stop' | 'restart') => {
    if (!svc.typeName) return;
    if (busy[svc.key]) return;
    setBusy((b) => ({ ...b, [svc.key]: true }));
    try {
      if (action === 'stop') {
        setOne(svc.key, 'stopping');
        await lifecycle.stop(svc.port);
        setOne(svc.key, 'stopped');
        showToast(`已停止 ${svc.name}`);
        return;
      }
      if (action === 'restart') {
        await lifecycle.stop(svc.port);
      }
      setOne(svc.key, 'starting');
      const ok = await lifecycle.launchService(svc.typeName, svc.kind);
      if (!ok) {
        setOne(svc.key, 'stopped');
        showToast(`${svc.name} 启动失败`, 'error');
        return;
      }
      // 轮询等待端口就绪（最长 ~30s = 20 次 × 1.5s，CosyVoice 模型加载可能需要较久）
      let tries = 0;
      let up = false;
      while (!up && tries < 20) {
        if (await probe(svc.port)) {
          up = true;
          break;
        }
        tries += 1;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (up) {
        setOne(svc.key, 'running');
        showToast(`已启动 ${svc.name}`);
      } else {
        setOne(svc.key, 'stopped');
        showToast(`${svc.name} 启动超时（模型加载较慢？），请稍后再试`, 'warning');
      }
    } catch (e) {
      showToast(String(e), 'error');
      setOne(svc.key, 'stopped');
    } finally {
      setBusy((b) => ({ ...b, [svc.key]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-4 font-normal pb-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section title={t('settings.services_section.status', '本地服务运行状态')}>
        <div className="text-sm text-neutral-500 leading-relaxed">
          语音服务（TTS / STT）在应用启动时会自动拉起；若异常退出可在此手动
          <span className="text-emerald-500"> 启动</span> /
          <span className="text-rose-500"> 停止</span> /<span className="text-sky-500"> 重启</span>
          。Hermes Gateway 与 Core API 为核心服务，仅展示状态。
        </div>

        <div className="mt-3 flex flex-col divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
          {services.map((svc) => {
            const st = status[svc.key] ?? 'stopped';
            const meta = STATUS_META[st];
            const isBusy = busy[svc.key] || st === 'starting' || st === 'stopping';
            return (
              <div key={svc.key} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: meta.dot }}
                  />
                  <div>
                    <div className="text-sm font-medium">{svc.name}</div>
                    <div className="text-xs text-neutral-400">
                      端口 {svc.port} ·{' '}
                      {t(`settings.services_section.status_${svc.kind}`, svc.kind)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${meta.color} w-14 text-right`}>{meta.label}</span>
                  {!svc.core && (
                    <div className="flex gap-1.5">
                      {st !== 'running' && (
                        <button
                          className="px-2.5 py-1 rounded-md text-xs bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                          disabled={isBusy}
                          onClick={() => void run(svc, 'start')}
                        >
                          启动
                        </button>
                      )}
                      {st === 'running' && (
                        <button
                          className="px-2.5 py-1 rounded-md text-xs bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 disabled:opacity-50 transition-colors"
                          disabled={isBusy}
                          onClick={() => void run(svc, 'stop')}
                        >
                          停止
                        </button>
                      )}
                      {st === 'running' && (
                        <button
                          className="px-2.5 py-1 rounded-md text-xs bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 disabled:opacity-50 transition-colors"
                          disabled={isBusy}
                          onClick={() => void run(svc, 'restart')}
                        >
                          重启
                        </button>
                      )}
                    </div>
                  )}
                  {isBusy && (
                    <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 text-neutral-400" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {!isTauriEnv() && (
        <div className="text-xs text-neutral-400">
          当前非 Tauri 环境（浏览器预览），仅展示配置。
        </div>
      )}
    </div>
  );
}

export default StatusPage;
