import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch, SliderRow, useToast } from '../../components';
import { proactiveScheduler } from '../../../services/proactive/scheduler';
import { getBehaviorRegistry } from '../../../services/behavior';
import {
  BehaviorConfig,
  DEFAULT_BEHAVIOR,
  BEHAVIOR_STORAGE_KEY,
  loadBehaviorConfig,
  saveBehaviorConfig,
} from '../../../services/behavior/behaviorConfig';
import { permissionManager } from '../../../services/permission/PermissionManager';

/**
 * 角色行为设置页
 *
 * 只负责「角色怎么表现」：行为总开关、内心独白、主动聊天、内置行为库。
 *
 * 注意：上下文管理与长期记忆（RAG / LLM 增强抽取 / 混合检索）已迁至
 * 记忆体分区（/settings/memory/context 与 /settings/memory/long-term），
 * 不要再往本页添加记忆相关配置。
 */

function loadBehavior(): BehaviorConfig {
  return loadBehaviorConfig();
}

function saveBehavior(config: BehaviorConfig) {
  saveBehaviorConfig(config);
}

interface BehaviorEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
}

export function BehaviorPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [config, setConfig] = useState<BehaviorConfig>(() => loadBehavior());
  const [behaviors, setBehaviors] = useState<BehaviorEntry[]>([]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === BEHAVIOR_STORAGE_KEY) {
        setConfig(loadBehavior());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((patch: Partial<BehaviorConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveBehavior(next);
      return next;
    });
  }, []);

  // 将智能闲聊配置同步到主动行为调度器（即时生效）
  useEffect(() => {
    proactiveScheduler.updateConfig({
      enabled: config.enableSmartChat,
      // smartChatInterval 单位为秒，messageCooldown 单位为毫秒
      messageCooldown: config.smartChatInterval * 1000,
      dailyLimit: config.smartChatDailyLimit,
    });
  }, [config.enableSmartChat, config.smartChatInterval, config.smartChatDailyLimit]);

  const handleReset = useCallback(() => {
    setConfig({ ...DEFAULT_BEHAVIOR });
    saveBehavior({ ...DEFAULT_BEHAVIOR });
    showToast(t('settings.preferences.saved'), 'success');
  }, [showToast, t]);

  // 加载内置行为列表（延迟到 registry 初始化后）
  const refreshBehaviors = useCallback(() => {
    try {
      const registry = getBehaviorRegistry();
      setBehaviors(registry.getAllWithState());
    } catch {
      /* 某些环境（如纯设置窗口单独打开）可能未初始化 registry */
    }
  }, []);

  useEffect(() => {
    const t1 = setTimeout(refreshBehaviors, 150);
    const onStorage = () => refreshBehaviors();
    window.addEventListener('deskpet:behaviorrefresh', onStorage);
    return () => {
      clearTimeout(t1);
      window.removeEventListener('deskpet:behaviorrefresh', onStorage);
    };
  }, [refreshBehaviors]);

  const handleToggleBehavior = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        const registry = getBehaviorRegistry();
        await registry.setEnabled(id, enabled);
        setBehaviors(registry.getAllWithState());
        window.dispatchEvent(new CustomEvent('deskpet:behaviorrefresh'));
      } catch (err) {
        showToast(String(err), 'error');
      }
    },
    [showToast],
  );

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.models.behavior_section_title')}
        description={t('settings.models.behavior_section_desc')}
      >
        <div className="p-4 space-y-1">
          <SettingRow
            title={t('settings.models.enable_behavior')}
            description={t('settings.models.enable_behavior_desc')}
          >
            <Switch checked={config.enable} onClick={() => update({ enable: !config.enable })} />
          </SettingRow>
        </div>
      </Section>

      <Section
        title={t('settings.models.behavior_interaction_title')}
        description={t('settings.models.behavior_interaction_desc')}
      >
        <div className="p-4 space-y-1">
          <SettingRow
            title={t('settings.models.think_tags')}
            description={t('settings.models.think_tags_desc')}
          >
            <Switch
              checked={config.enableThinkTags}
              onClick={() => update({ enableThinkTags: !config.enableThinkTags })}
            />
          </SettingRow>

          <SettingRow
            title={t('settings.models.smart_chat')}
            description={t('settings.models.smart_chat_desc')}
          >
            <Switch
              checked={config.enableSmartChat}
              onClick={async () => {
                const next = !config.enableSmartChat;
                // 开启主动聊天时走权限闸：首次弹确认卡，之后按授权策略（低风险默认放行）
                if (next) {
                  try {
                    const res = await permissionManager.authorize('proactive_chat', {}, { source: 'behavior' });
                    if (!res.allowed) {
                      showToast(
                        t('settings.models.smart_chat_blocked', { defaultValue: '已取消开启主动聊天' }),
                        'info',
                      );
                      return;
                    }
                  } catch {
                    // 权限 UI 不可用等异常：安全降级为允许，不阻断功能
                  }
                }
                update({ enableSmartChat: next });
              }}
            />
          </SettingRow>

          <SettingRow
            title={t('settings.models.proactive_tts')}
            description={t('settings.models.proactive_tts_desc')}
          >
            <Switch
              checked={config.proactiveTts}
              onClick={() => update({ proactiveTts: !config.proactiveTts })}
            />
          </SettingRow>
        </div>
      </Section>

      {config.enableSmartChat && (
        <Section
          title={t('settings.models.smart_chat_settings_title')}
          description={t('settings.models.smart_chat_settings_desc')}
        >
          <SliderRow
            label={t('settings.models.smart_chat_interval')}
            value={config.smartChatInterval}
            min={10}
            max={600}
            step={10}
            unit={t('settings.models.smart_chat_interval_unit')}
            desc={t('settings.models.smart_chat_interval_desc')}
            onChange={(v) => update({ smartChatInterval: v })}
          />
          <SliderRow
            label={t('settings.models.smart_chat_daily_limit')}
            value={config.smartChatDailyLimit}
            min={1}
            max={100}
            step={1}
            unit={t('settings.models.smart_chat_daily_limit_unit')}
            desc={t('settings.models.smart_chat_daily_limit_desc')}
            onChange={(v) => update({ smartChatDailyLimit: v })}
          />
        </Section>
      )}

      {/* 内置行为管理 */}
      <Section
        title={t('settings.models.behavior_builtin_title')}
        description={t('settings.models.behavior_builtin_desc')}
      >
        <div className="p-4 space-y-2">
          {behaviors.length === 0 ? (
            <p className="text-xs text-neutral-400 py-2">
              {t('settings.models.behavior_builtin_empty')}
            </p>
          ) : (
            behaviors.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-500">
                    <Icon icon="solar:stars-bold-duotone" className="text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-800 truncate">
                        {b.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        v{b.version}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 truncate">{b.description}</p>
                  </div>
                </div>
                <Switch
                  checked={b.enabled}
                  onClick={() => handleToggleBehavior(b.id, !b.enabled)}
                />
              </div>
            ))
          )}
          <button
            type="button"
            onClick={refreshBehaviors}
            className="mt-2 text-xs text-neutral-400 hover:text-neutral-600 flex items-center gap-1"
          >
            <Icon icon="solar:refresh-linear" className="text-xs" />
            {t('settings.models.behavior_refresh')}
          </button>
        </div>
      </Section>

      <div className="flex justify-center mt-4">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          {t('settings.models.reset_behavior')}
        </button>
      </div>
    </div>
  );
}

export default BehaviorPage;
