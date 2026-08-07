import { useEffect } from 'react';
import { personaManager } from '../services/persona/manager';
import { personaHotswap } from '../services/persona/hotswap';

/**
 * 封装人设自动切换逻辑：
 * - personaManager 就绪后从持久化恢复自动切换规则
 * - 每分钟检查自动切换条件（时段 + 心情 + 好感度）
 * - cleanup 清除定时器
 */
export function usePersonaAutoSwitch(
  emotionCtxRef: React.RefObject<{ mood: string; favorability: number } | null>,
): void {
  useEffect(() => {
    let mounted = true;
    personaManager.ready.then(() => {
      if (!mounted) return;
      // 从持久化恢复自动切换规则
      try {
        const rulesRaw = localStorage.getItem('deskpet_personaAutoRules');
        if (rulesRaw) {
          const rules = JSON.parse(rulesRaw) as Array<{
            id: string;
            targetPersonaId: string;
            triggerHour: number;
            enabled: boolean;
          }>;
          personaHotswap
            .getAutoRules()
            .slice()
            .forEach((r) => personaHotswap.removeAutoRule(r.id));
          rules.forEach((r) =>
            personaHotswap.addAutoRule({
              ...r,
              triggerMood: '',
              favorabilityRange: [0, 100],
              priority: 50,
            }),
          );
        }
      } catch {
        /* ignore */
      }
    });

    // 定时器驱动角色自动切换（每分钟检查一次）
    const autoSwitchTimer = setInterval(() => {
      if (!mounted) return;
      const hour = new Date().getHours();
      const mood = emotionCtxRef.current?.mood ?? 'neutral';
      const favorability = emotionCtxRef.current?.favorability ?? 50;
      personaHotswap.autoSwitch(hour, mood, favorability).catch(() => {});
    }, 60_000);

    return () => {
      mounted = false;
      clearInterval(autoSwitchTimer);
    };
  }, [emotionCtxRef]);
}
