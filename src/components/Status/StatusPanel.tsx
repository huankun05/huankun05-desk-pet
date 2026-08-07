import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EmotionState,
  Personality,
  EmotionConfig,
  MoodType,
  EmotionType,
} from '../../hooks/useEmotion';

interface StatusPanelProps {
  state: EmotionState;
  history: {
    emotion: EmotionType;
    intensity: number;
    mood: MoodType;
    favorability: number;
    timestamp: Date;
    reason?: string;
  }[];
  onPersonalityChange: (p: Partial<Personality>) => void;
  onConfigChange: (c: Partial<EmotionConfig>) => void;
  onClose: () => void;
  standalone?: boolean;
}

const moodEmoji: Record<MoodType, string> = {
  cheerful: '😄',
  content: '😊',
  melancholy: '😔',
  excited: '🤩',
  calm: '😌',
};
const emotionEmoji: Record<EmotionType, string> = {
  idle: '😊',
  happy: '😄',
  sad: '😢',
  thinking: '🤔',
  surprised: '😮',
  talking: '💬',
  angry: '😠',
  shy: '😳',
  excited: '🤩',
  curious: '🧐',
  sleepy: '😴',
};
const emotionName: Record<EmotionType, string> = {
  idle: 'status.emotions.calm',
  happy: 'status.emotions.happy',
  sad: 'status.emotions.sad',
  thinking: 'status.emotions.thinking',
  surprised: 'status.emotions.surprised',
  talking: 'status.emotions.chatting',
  angry: 'status.emotions.angry',
  shy: 'status.emotions.shy',
  excited: 'status.emotions.excited',
  curious: 'status.emotions.calm',
  sleepy: 'status.emotions.sleepy',
};
const moodName: Record<MoodType, string> = {
  cheerful: 'status.emotions.happy',
  content: 'status.emotions.calm',
  melancholy: 'status.emotions.sad',
  excited: 'status.emotions.excited',
  calm: 'status.emotions.calm',
};

// 情绪主题色（用于渐变和动画）
const emotionColor: Record<EmotionType, string> = {
  idle: '#6366f1',
  happy: '#f59e0b',
  sad: '#6366f1',
  thinking: '#8b5cf6',
  surprised: '#f97316',
  talking: '#22c55e',
  angry: '#ef4444',
  shy: '#ec4899',
  excited: '#f59e0b',
  curious: '#14b8a6',
  sleepy: '#94a3b8',
};
const moodColor: Record<MoodType, string> = {
  cheerful: '#f59e0b',
  content: '#22c55e',
  melancholy: '#6366f1',
  excited: '#f97316',
  calm: '#94a3b8',
};

function _getFavColor(fav: number): string {
  if (fav >= 80) return '#f59e0b';
  if (fav >= 60) return '#10b981';
  if (fav >= 40) return '#6366f1';
  if (fav >= 20) return '#94a3b8';
  return '#ef4444';
}

function getFavLabel(fav: number): string {
  if (fav >= 80) return 'Best';
  if (fav >= 60) return 'Close';
  if (fav >= 40) return 'Friendly';
  if (fav >= 20) return 'Normal';
  return 'Cold';
}

function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

/** 带输入框 + 滑条 + 提示的参数控件（值完全由父组件控制） */
function ParamControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  tooltip,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  tooltip: string;
  onChange: (v: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);

  // 外部值变化时，更新输入框显示
  useEffect(() => {
    if (!editing && inputRef.current) {
      inputRef.current.value = value.toFixed(step < 1 ? 2 : 1);
    }
  }, [value, step, editing]);

  const handleSlider = useCallback(
    (v: number) => {
      onChange(v);
      if (inputRef.current) {
        inputRef.current.value = v.toFixed(step < 1 ? 2 : 1);
      }
    },
    [step, onChange],
  );

  const handleInputCommit = useCallback(() => {
    setEditing(false);
    const raw = inputRef.current?.value || '';
    const num = parseFloat(raw);
    if (!isNaN(num)) {
      onChange(Math.min(max, Math.max(min, num)));
    } else {
      if (inputRef.current) inputRef.current.value = value.toFixed(step < 1 ? 2 : 1);
    }
  }, [min, max, step, value, onChange]);

  return (
    <div style={{ marginBottom: '12px' }} title={tooltip}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '4px',
        }}
      >
        <span style={{ color: 'var(--text-secondary)', fontSize: '12px', cursor: 'help' }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            ref={inputRef}
            type="number"
            min={min}
            max={max}
            step={step}
            defaultValue={value.toFixed(step < 1 ? 2 : 1)}
            onFocus={() => setEditing(true)}
            onBlur={handleInputCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleInputCommit();
            }}
            style={{
              width: '48px',
              padding: '2px 4px',
              borderRadius: '4px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-glass)',
              color: 'var(--text-primary)',
              fontSize: '11px',
              textAlign: 'right',
            }}
          />
          {unit && <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{unit}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => handleSlider(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  );
}

function SectionTitle({
  text,
  expanded,
  onToggle,
}: {
  text: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        color: 'var(--text-secondary)',
        fontSize: '13px',
        marginBottom: '10px',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={onToggle}
    >
      ── {text} {expanded ? '▼' : '▶'} ──
    </div>
  );
}

export const StatusPanel = memo(function StatusPanel({
  state,
  history,
  onPersonalityChange,
  onConfigChange,
  onClose,
  standalone,
}: StatusPanelProps) {
  const { t } = useTranslation();
  const [showPersonality, setShowPersonality] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHistory, setShowHistory] = useState(true);

  // 安全检查：state 可能不完整（从 localStorage 恢复时缺少字段）
  const safeState = {
    mood: state?.mood || 'cheerful',
    moodIntensity: state?.moodIntensity ?? 0.5,
    emotion: state?.emotion || 'happy',
    emotionIntensity: state?.emotionIntensity ?? 0.5,
    favorability: state?.favorability ?? 50,
    personality: {
      cheerfulness: state?.personality?.cheerfulness ?? 0.7,
      sensitivity: state?.personality?.sensitivity ?? 0.6,
      sociability: state?.personality?.sociability ?? 0.8,
      energy: state?.personality?.energy ?? 0.7,
    },
    config: {
      decayInterval: state?.config?.decayInterval ?? 120000,
      decayMood: state?.config?.decayMood ?? 0.01,
      decayEmotion: state?.config?.decayEmotion ?? 0.03,
      idleDecayStart: state?.config?.idleDecayStart ?? 900000,
      cooldownMs: state?.config?.cooldownMs ?? 3000,
      cooldownFactor: state?.config?.cooldownFactor ?? 0.3,
      maxIntensityPerAction: state?.config?.maxIntensityPerAction ?? 0.9,
      favPatHead: state?.config?.favPatHead ?? 3,
      favTapBody: state?.config?.favTapBody ?? 1,
      favStepFoot: state?.config?.favStepFoot ?? -5,
      favTalk: state?.config?.favTalk ?? 2,
      favTooMuch: state?.config?.favTooMuch ?? -2,
    },
  };

  const recentHistory = [...(history || [])].reverse().slice(0, 15);
  const fav = safeState.favorability;

  const currentMoodColor = moodColor[safeState.mood] || 'var(--accent)';
  const card = (
    <div
      style={{
        background: standalone
          ? `linear-gradient(135deg, var(--bg-base) 0%, ${currentMoodColor}08 100%)`
          : `linear-gradient(135deg, var(--bg-surface) 0%, ${currentMoodColor}10 100%)`,
        borderRadius: standalone ? 0 : '16px',
        padding: '20px',
        width: standalone ? '100%' : '360px',
        height: standalone ? '100%' : 'auto',
        maxHeight: standalone ? 'none' : '85vh',
        overflowY: 'auto',
        boxSizing: 'border-box',
        transition: 'background 0.5s ease',
      }}
    >
      {/* 顶部情绪色条 */}
      <div
        style={{
          height: '4px',
          borderRadius: '2px',
          marginBottom: '12px',
          background: `linear-gradient(90deg, ${emotionColor[safeState.emotion]}, ${currentMoodColor})`,
          transition: 'background 0.5s ease',
          boxShadow: `0 0 8px ${emotionColor[safeState.emotion]}40`,
        }}
      />

      {/* 标题 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '18px' }}>
          💗 {t('status.title')}
        </h3>
        {!standalone && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '22px',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* 当前状态 */}
      <div
        style={{
          padding: '14px',
          background: `linear-gradient(135deg, ${emotionColor[safeState.emotion]}25, ${currentMoodColor}20)`,
          borderRadius: '10px',
          marginBottom: '16px',
          border: `1.5px solid ${emotionColor[safeState.emotion]}50`,
          transition: 'all 0.5s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
          <div title="当前心情：长期基础情感倾向">
            <div style={{ fontSize: '30px' }}>{moodEmoji[safeState.mood]}</div>
            <div style={{ color: 'var(--text-primary)', fontSize: '13px', marginTop: '2px' }}>
              {t(moodName[safeState.mood])}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              {(safeState.moodIntensity * 100).toFixed(1)}%
            </div>
          </div>
          <div title="当前情绪：短期反应">
            <div style={{ fontSize: '30px' }}>{emotionEmoji[safeState.emotion]}</div>
            <div style={{ color: 'var(--text-primary)', fontSize: '13px', marginTop: '2px' }}>
              {t(emotionName[safeState.emotion])}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              {(safeState.emotionIntensity * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* 好感度 */}
      <div style={{ marginBottom: '16px' }} title="好感度：影响角色态度和气泡内容">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            💖 {t('status.favorability')}
          </span>
          <span style={{ color: 'var(--accent)', fontSize: '13px', fontWeight: 600 }}>
            {fav}/100
          </span>
        </div>
        <div
          style={{
            height: '8px',
            backgroundColor: 'var(--bg-glass)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${fav}%`,
              backgroundColor: 'var(--accent)',
              borderRadius: '4px',
              transition: 'width 0.3s',
            }}
          />
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '3px' }}>
          {getFavLabel(fav)}
        </div>
      </div>

      {/* 性格调节 */}
      <div style={{ marginBottom: '16px' }}>
        <SectionTitle
          text={t('status.personality')}
          expanded={showPersonality}
          onToggle={() => setShowPersonality(!showPersonality)}
        />
        {showPersonality && (
          <div
            style={{
              padding: '10px',
              backgroundColor: 'var(--bg-glass)',
              borderRadius: '8px',
            }}
          >
            <ParamControl
              label={t('status.personality_cheerfulness')}
              value={safeState.personality.cheerfulness}
              min={0}
              max={1}
              step={0.1}
              tooltip="影响 happy 触发概率。越高越容易开心"
              onChange={(v) => onPersonalityChange({ cheerfulness: v })}
            />
            <ParamControl
              label={t('status.personality_sensitivity')}
              value={safeState.personality.sensitivity}
              min={0}
              max={1}
              step={0.1}
              tooltip="影响 shy/angry 反应强度。越高越容易害羞或生气"
              onChange={(v) => onPersonalityChange({ sensitivity: v })}
            />
            <ParamControl
              label={t('status.personality_sociability')}
              value={safeState.personality.sociability}
              min={0}
              max={1}
              step={0.1}
              tooltip="影响闲聊频率。越高越主动找你说话"
              onChange={(v) => onPersonalityChange({ sociability: v })}
            />
            <ParamControl
              label={t('status.personality_energy')}
              value={safeState.personality.energy}
              min={0}
              max={1}
              step={0.1}
              tooltip="影响衰减速率。越高情感持续更久"
              onChange={(v) => onPersonalityChange({ energy: v })}
            />
          </div>
        )}
      </div>

      {/* 高级设置 */}
      <div style={{ marginBottom: '16px' }}>
        <SectionTitle
          text={t('status.advanced_settings')}
          expanded={showAdvanced}
          onToggle={() => setShowAdvanced(!showAdvanced)}
        />
        {showAdvanced && (
          <div
            style={{
              padding: '10px',
              backgroundColor: 'var(--bg-glass)',
              borderRadius: '8px',
            }}
          >
            <ParamControl
              label={t('status.decay_interval')}
              value={safeState.config.decayInterval / 1000}
              min={30}
              max={600}
              step={10}
              unit={t('status.seconds')}
              tooltip="多久检查一次衰减"
              onChange={(v) => onConfigChange({ decayInterval: v * 1000 })}
            />
            <ParamControl
              label={t('status.mood_decay')}
              value={safeState.config.decayMood * 100}
              min={0}
              max={10}
              step={0.5}
              unit="%"
              tooltip="每次衰减心情降低多少"
              onChange={(v) => onConfigChange({ decayMood: v / 100 })}
            />
            <ParamControl
              label={t('status.emotion_decay')}
              value={safeState.config.decayEmotion * 100}
              min={0}
              max={10}
              step={0.5}
              unit="%"
              tooltip="每次衰减情绪降低多少"
              onChange={(v) => onConfigChange({ decayEmotion: v / 100 })}
            />
            <ParamControl
              label={t('status.idle_decay_start')}
              value={safeState.config.idleDecayStart / 60000}
              min={1}
              max={60}
              step={1}
              unit={t('status.minutes')}
              tooltip="多久不互动后开始衰减"
              onChange={(v) => onConfigChange({ idleDecayStart: v * 60000 })}
            />
            <ParamControl
              label={t('status.cooldown_ms')}
              value={safeState.config.cooldownMs / 1000}
              min={0}
              max={30}
              step={0.5}
              unit={t('status.seconds')}
              tooltip="同一操作冷却期"
              onChange={(v) => onConfigChange({ cooldownMs: v * 1000 })}
            />
            <ParamControl
              label={t('status.cooldown_factor')}
              value={safeState.config.cooldownFactor * 100}
              min={0}
              max={100}
              step={5}
              unit="%"
              tooltip="冷却期内效果衰减到百分之几"
              onChange={(v) => onConfigChange({ cooldownFactor: v / 100 })}
            />
            <ParamControl
              label={t('status.max_intensity')}
              value={safeState.config.maxIntensityPerAction * 100}
              min={10}
              max={100}
              step={5}
              unit="%"
              tooltip="单次互动最大强度增量"
              onChange={(v) => onConfigChange({ maxIntensityPerAction: v / 100 })}
            />
            <div
              style={{
                color: 'var(--text-muted)',
                fontSize: '11px',
                marginTop: '10px',
                marginBottom: '6px',
              }}
            >
              {t('status.fav_change_label')}
            </div>
            <ParamControl
              label={t('status.fav_pat_head')}
              value={safeState.config.favPatHead}
              min={0}
              max={10}
              step={0.5}
              tooltip="每次抚摸增加的好感度"
              onChange={(v) => onConfigChange({ favPatHead: v })}
            />
            <ParamControl
              label={t('status.fav_tap_body')}
              value={safeState.config.favTapBody}
              min={0}
              max={10}
              step={0.5}
              tooltip="每次拍打增加的好感度"
              onChange={(v) => onConfigChange({ favTapBody: v })}
            />
            <ParamControl
              label={t('status.fav_step_foot')}
              value={Math.abs(safeState.config.favStepFoot)}
              min={0}
              max={20}
              step={0.5}
              tooltip="每次踩脚减少的好感度"
              onChange={(v) => onConfigChange({ favStepFoot: -Math.abs(v) })}
            />
            <ParamControl
              label={t('status.fav_talk')}
              value={safeState.config.favTalk}
              min={0}
              max={10}
              step={0.5}
              tooltip="每次对话增加的好感度"
              onChange={(v) => onConfigChange({ favTalk: v })}
            />
          </div>
        )}
      </div>

      {/* 情绪分布统计 */}
      {recentHistory.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '8px' }}>
            {t('status.emotion_distribution')}
          </div>
          <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '40px' }}>
            {(() => {
              const counts: Record<string, number> = {};
              recentHistory.forEach((e) => {
                counts[e.emotion] = (counts[e.emotion] || 0) + 1;
              });
              const max = Math.max(...Object.values(counts), 1);
              return Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([emo, cnt]) => (
                  <div
                    key={emo}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: `${(cnt / max) * 100}%`,
                        minHeight: '6px',
                        borderRadius: '3px 3px 0 0',
                        backgroundColor: emotionColor[emo as EmotionType] || 'var(--accent)',
                        transition: 'height 0.4s ease',
                      }}
                    />
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{emo}</span>
                  </div>
                ));
            })()}
          </div>
        </div>
      )}

      {/* 情感历史 */}
      <div>
        <SectionTitle
          text={t('status.recent_changes')}
          expanded={showHistory}
          onToggle={() => setShowHistory(!showHistory)}
        />
        {showHistory && (
          <div>
            {recentHistory.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  textAlign: 'center',
                  padding: '10px',
                }}
              >
                {t('status.no_records')}
              </div>
            ) : (
              recentHistory.map((entry, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: i === 0 ? `${emotionColor[entry.emotion]}15` : 'transparent',
                    marginBottom: '1px',
                    animation: i === 0 ? 'statusPulse 1s ease' : 'none',
                  }}
                >
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>
                    {emotionEmoji[entry.emotion]}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
                      {t(emotionName[entry.emotion])} · {(entry.intensity * 100).toFixed(1)}%
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                      {entry.reason || t('status.unknown')} · {formatTime(entry.timestamp)}
                    </div>
                  </div>
                  {/* 强度小条 */}
                  <div
                    style={{
                      width: '30px',
                      height: '4px',
                      backgroundColor: 'var(--bg-glass)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: `${entry.intensity * 100}%`,
                        height: '100%',
                        backgroundColor: emotionColor[entry.emotion],
                        borderRadius: '2px',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (standalone) return card;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--bg-glass-dark)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {card}
    </div>
  );
});
