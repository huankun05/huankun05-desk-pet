/**
 * 前端 useEmotion ⇄ 后端 core 服务（heart/emotion）的桥接映射。
 *
 * 合并方向：后端为单一事实源（SQLite + 人格基线/漂移），
 * 前端 useEmotion 保留本地实时状态（主窗表情/行为需要），
 * 但初始化从后端读、事件向后端双写，两套状态最终收敛到后端引擎。
 */
import type { EmotionState as ApiEmotionState } from './coreApi';
import type { EmotionState, EmotionType, MoodType } from '../hooks/useEmotion';

/** 后端 mood_label（英文标签）→ 前端 EmotionType（本地无 calm/anxious，映射到就近表情） */
const LABEL_TO_EMOTION: Record<string, EmotionType> = {
  happy: 'happy',
  sad: 'sad',
  anxious: 'sad', // 本地无 anxious，归入 sad
  calm: 'idle', // 平静 → 中性表情
  excited: 'excited',
  angry: 'angry',
  开心: 'happy',
  悲伤: 'sad',
  焦虑: 'sad',
  平静: 'idle',
  兴奋: 'excited',
  愤怒: 'angry',
  温和: 'idle',
};

/** PAD → 前端 MoodType（5 种基调） */
function padToMood(p: number, a: number): MoodType {
  if (p > 0.3) return a > 0.3 ? 'excited' : 'cheerful';
  if (p < -0.3) return a > 0 ? 'melancholy' : 'calm';
  return a > 0.3 ? 'excited' : 'content';
}

/** 后端 heart/emotion 响应 → 本地情绪字段 */
export function apiEmotionToLocal(
  api: ApiEmotionState,
): Pick<EmotionState, 'mood' | 'moodIntensity' | 'emotion' | 'emotionIntensity'> {
  const p = Number(api.pleasure) || 0;
  const a = Number(api.arousal) || 0;
  const intensity = Math.max(0.1, Math.min(1, (Math.abs(p) + Math.abs(a)) / 2 + 0.2));

  const label = api.mood ?? '';
  const emotion: EmotionType = LABEL_TO_EMOTION[label] ?? 'happy';

  return {
    mood: padToMood(p, a),
    moodIntensity: intensity,
    emotion,
    emotionIntensity: intensity,
  };
}
