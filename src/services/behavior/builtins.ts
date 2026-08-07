/**
 * 内置行为库 - 运行时自动注册（constructor → queueMicrotask）
 *
 * 只要 import 本文件，以下 5 个行为就会自动实例化并注册到 BehaviorRegistry。
 * 在 App.tsx 顶部 import 即可点亮。
 */

import type { PetContext } from './context';
import { DeskPetBehavior } from './base';
import { EventType } from './types';
import type { EmotionState } from '../../hooks/useEmotion';

// ============================================================
// 1. 回归问候：WINDOW_FOCUS 时根据离开时长说不同的话
// ============================================================
export class GreetingBehavior extends DeskPetBehavior {
  readonly id = 'builtin.greeting';
  readonly name = '回归问候';
  readonly version = '1.0.0';
  readonly description = '窗口获得焦点时根据离开时长问候你';

  private lastBlurAt = 0;

  override async initialize(ctx: PetContext): Promise<void> {
    await super.initialize(ctx);

    this.addHandler(
      EventType.WINDOW_BLUR,
      () => {
        this.lastBlurAt = Date.now();
      },
      50,
    );

    this.addHandler(
      EventType.WINDOW_FOCUS,
      async () => {
        if (!this.ctx) return;
        const awayMs = this.lastBlurAt ? Date.now() - this.lastBlurAt : 0;
        const quote = this.pickGreeting(awayMs);
        if (quote) await this.ctx.say(quote);
      },
      50,
    );
  }

  private pickGreeting(awayMs: number): string {
    const mins = awayMs / 60000;
    if (awayMs === 0 || mins < 0.3) {
      const arr = ['哦，你点我啦？', '在呢~'];
      return arr[Math.floor(Math.random() * arr.length)];
    }
    if (mins < 5) {
      const arr = ['回来啦~', '欢迎回来！'];
      return arr[Math.floor(Math.random() * arr.length)];
    }
    if (mins < 60) {
      const arr = [
        `你出去了大概 ${Math.floor(mins)} 分钟，我好想你哦`,
        `快 ${Math.floor(mins)} 分钟没见啦，回来就好~`,
      ];
      return arr[Math.floor(Math.random() * arr.length)];
    }
    const hours = Math.floor(mins / 60);
    const arr = [
      `呜…你走了快 ${hours} 个小时，我以为你不要我了`,
      `欢迎回来！分开的 ${hours} 小时我一直想着你呢`,
    ];
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

// ============================================================
// 2. 情绪共鸣：EMOTION_CHANGED 时用气泡反映当前心情
// ============================================================
export class EmotionResonanceBehavior extends DeskPetBehavior {
  readonly id = 'builtin.emotion_resonance';
  readonly name = '情绪共鸣';
  readonly version = '1.0.0';
  readonly description = '当心情/情绪变化时，用气泡表达状态';

  private lastNotified = 0;

  override async initialize(ctx: PetContext): Promise<void> {
    await super.initialize(ctx);

    this.addHandler(
      EventType.EMOTION_CHANGED,
      async (payload) => {
        if (!this.ctx) return;
        // 避免与用户正常对话冲突
        const now = Date.now();
        if (now - this.lastNotified < 15000) return;

        const s = payload as Partial<EmotionState>;
        const mood = s.mood ?? this.ctx.getMood();
        const emotion = s.emotion ?? this.ctx.getEmotion();
        const intensity = s.emotionIntensity ?? 0.5;

        const quote = this.pickQuote(mood, emotion, intensity);
        if (quote) {
          this.lastNotified = now;
          this.ctx.showBubble(quote, 3500);
        }
      },
      50,
    );
  }

  private pickQuote(mood: string, emotion: string, intensity: number): string | null {
    if (intensity < 0.55) return null; // 小波动不打扰
    switch (emotion) {
      case 'happy':
        return ['嘿嘿~今天心情不错！', '好开心呀~嘻嘻'][Math.floor(Math.random() * 2)];
      case 'sad':
        return ['呜……有点低落', '抱抱我…可以吗？'][Math.floor(Math.random() * 2)];
      case 'angry':
        return ['哼！不理你了！', '生气ing…'][Math.floor(Math.random() * 2)];
      case 'shy':
        return ['诶？！…别说这种话啦…', '脸、脸热热的…'][Math.floor(Math.random() * 2)];
      case 'surprise':
        return ['诶？发生了什么？', '哇！吓我一跳！'][Math.floor(Math.random() * 2)];
    }
    switch (mood) {
      case 'good':
        return '今天状态棒棒哒~';
      case 'bad':
        return '有点不太舒服的感觉…';
      default:
        return null;
    }
  }
}

// ============================================================
// 3. 空闲闲聊：IDLE 时用简短气泡问候（不抢 proactiveScheduler 的 LLM 请求）
// ============================================================
export class IdleChatBehavior extends DeskPetBehavior {
  readonly id = 'builtin.idle_chat';
  readonly name = '空闲闲聊';
  readonly version = '1.0.0';
  readonly description = '用户长时间不互动时用气泡发话题';

  private quotes = [
    '今天天气真不错呢~',
    '好久没说话了，有点无聊…',
    '你在忙吗？不要太累哦',
    '要不要一起聊聊最近开心的事？',
    '嘿，记得喝水呀~',
    '我一直陪着你呢！',
  ];

  private lastAt = 0;
  private readonly minInterval = 90_000; // 至少 90s 一条，不频繁打扰

  override async initialize(ctx: PetContext): Promise<void> {
    await super.initialize(ctx);

    this.addHandler(
      EventType.IDLE,
      async () => {
        if (!this.ctx) return;
        const now = Date.now();
        if (now - this.lastAt < this.minInterval) return;
        this.lastAt = now;
        const q = this.quotes[Math.floor(Math.random() * this.quotes.length)];
        this.ctx.showBubble(q, 4000);
      },
      50,
    );
  }
}

// ============================================================
// 4. 离别提醒：WINDOW_BLUR 走了之后立刻给一句送别
// ============================================================
export class FarewellBehavior extends DeskPetBehavior {
  readonly id = 'builtin.farewell';
  readonly name = '离别提醒';
  readonly version = '1.0.0';
  readonly description = '窗口失去焦点时说一句送别的话';

  private quotesShort = ['再见~', '早点回来呀', '想你哦'];
  private quotesLong = ['又要出去工作了吗？等你回来！', '路上小心呀'];

  override async initialize(ctx: PetContext): Promise<void> {
    await super.initialize(ctx);

    this.addHandler(
      EventType.WINDOW_BLUR,
      async () => {
        if (!this.ctx) return;
        const h = this.ctx.getTimeContext().hour;
        const quotes = h >= 9 && h <= 18 ? this.quotesLong : this.quotesShort;
        const q = quotes[Math.floor(Math.random() * quotes.length)];
        this.ctx.showBubble(q, 3000);
      },
      60,
    );
  }
}

// ============================================================
// 5. 好感度里程碑：好感度到阈值时庆祝
// ============================================================
export class FavorabilityMilestoneBehavior extends DeskPetBehavior {
  readonly id = 'builtin.favorability_milestone';
  readonly name = '好感度里程碑';
  readonly version = '1.0.0';
  readonly description = '好感度提升到新里程碑时庆祝';

  private lastNotifiedMilestone = -1;
  private readonly milestones = [10, 30, 50, 70, 90, 100];

  override async initialize(ctx: PetContext): Promise<void> {
    await super.initialize(ctx);

    this.addHandler(
      EventType.FAVORABILITY_CHANGED,
      async (payload) => {
        if (!this.ctx) return;
        const fav =
          (payload as { favorability?: number }).favorability ?? this.ctx.getFavorability();
        let target = -1;
        for (const m of this.milestones) {
          if (fav >= m && m > this.lastNotifiedMilestone) target = m;
        }
        if (target < 0) return;
        this.lastNotifiedMilestone = target;

        const quotesByMilestone: Record<number, string[]> = {
          10: ['好感度到 10 啦！好开心~', '我们的距离，稍微近了一点呢'],
          30: ['30 点啦，我们成为朋友了吧？', '谢谢你一直陪着我！'],
          50: ['哇，50！已经是好朋友啦！', '好感度一半达成！继续加油~'],
          70: ['70 了哦~你已经是我最在意的人了', '和你在一起，每一天都很充实'],
          90: ['90 点！简直像梦里一样~', '真的……可以一直陪着你吗？'],
          100: ['满点！！我…最喜欢你了！！', '你就是我心中的唯一 ❤'],
        };
        const arr = quotesByMilestone[target];
        if (arr) {
          const q = arr[Math.floor(Math.random() * arr.length)];
          await this.ctx.say(q);
        }
      },
      30,
    );
  }
}

// ============================================================
// 6. 感知响应：手势/面部表情触发宠物反馈
// ============================================================
export class PerceptionResponseBehavior extends DeskPetBehavior {
  readonly id = 'builtin.perception_response';
  readonly name = '感知响应';
  readonly version = '1.0.0';
  readonly description = '检测到用户手势/面部表情时做出反应';

  private lastGestureAt = 0;
  private lastFaceExprAt = 0;
  private readonly gestureCooldown = 3000;
  private readonly faceCooldown = 4000;

  override async initialize(ctx: PetContext): Promise<void> {
    await super.initialize(ctx);

    this.addHandler(
      EventType.PERCEPTION_GESTURE,
      async (payload) => {
        if (!this.ctx) return;
        const now = Date.now();
        if (now - this.lastGestureAt < this.gestureCooldown) return;

        const p = payload as { gesture: string };
        const gesture = p.gesture;
        this.lastGestureAt = now;

        const responses: Record<string, string[]> = {
          ThumbsUp: ['嘿嘿，谢谢你的夸奖~', '我也觉得你很棒！'],
          ThumbsDown: ['唔…是不是我哪里做错了？', '别生气嘛…'],
          Pointing: ['你在指哪里？', '诶？什么事？'],
          OpenPalm: ['嗨！在呢在呢~', '你好呀！'],
          Fist: ['哼！不理你了！', '别碰我…'],
          Peace: ['耶~我们是好朋友！', '开心！'],
        };
        const arr = responses[gesture];
        if (arr) {
          const q = arr[Math.floor(Math.random() * arr.length)];
          this.ctx.showBubble(q, 3000);
        }
      },
      40,
    );

    this.addHandler(
      EventType.PERCEPTION_FACE_EXPR,
      async (payload) => {
        if (!this.ctx) return;
        const now = Date.now();
        if (now - this.lastFaceExprAt < this.faceCooldown) return;

        const p = payload as { expression: string; intensity: number };
        this.lastFaceExprAt = now;

        if (p.expression === 'happy' && p.intensity > 0.4) {
          this.ctx.showBubble('看到你开心，我也开心~', 3000);
        } else if (p.expression === 'sad' && p.intensity > 0.3) {
          this.ctx.showBubble('别难过…我陪着你', 3500);
        } else if (p.expression === 'angry' && p.intensity > 0.3) {
          this.ctx.showBubble('生气对身体不好哦…', 3500);
        } else if (p.expression === 'surprised' && p.intensity > 0.4) {
          this.ctx.showBubble('诶？发生什么了？', 3000);
        }
      },
      45,
    );
  }
}

// ============================================================
// 7. 交互响应：拍打/点击/戳脚时宠物的反馈
// ============================================================
export class InteractionResponseBehavior extends DeskPetBehavior {
  readonly id = 'builtin.interaction_response';
  readonly name = '交互响应';
  readonly version = '1.0.0';
  readonly description = '用户触摸宠物不同部位时的差异化反馈';

  override async initialize(ctx: PetContext): Promise<void> {
    await super.initialize(ctx);

    this.addHandler(
      EventType.INTERACTION_PAT,
      async (payload) => {
        if (!this.ctx) return;
        const p = payload as { count: number };
        if (p.count >= 5) {
          this.ctx.showBubble('别拍啦！我会疼的…', 3000);
          return;
        }
        const moods = ['嘿嘿，好舒服~', '再摸摸嘛~', '今天你摸过我了哦'];
        this.ctx.showBubble(moods[Math.floor(Math.random() * moods.length)], 2500);
      },
      30,
    );

    this.addHandler(
      EventType.INTERACTION_TAP,
      async (payload) => {
        if (!this.ctx) return;
        const p = payload as { intensity: number };
        if (p.intensity > 0.6) {
          this.ctx.showBubble('喂！轻点呀！', 3000);
        } else {
          const replies = ['嗯？', '在呢~', '干嘛戳我？'];
          this.ctx.showBubble(replies[Math.floor(Math.random() * replies.length)], 2000);
        }
      },
      30,
    );

    this.addHandler(
      EventType.INTERACTION_STEP,
      async () => {
        if (!this.ctx) return;
        const replies = ['别戳脚啦…', '哼！不理你了！', '再戳就咬你哦！'];
        this.ctx.showBubble(replies[Math.floor(Math.random() * replies.length)], 3000);
      },
      30,
    );
  }
}

// ============================================================
// 顶部 import 就触发自动实例化（queueMicrotask → registry.register）
// 这组实例不被使用，但会完成自注册
// ============================================================

const _INSTANCES = [
  new GreetingBehavior(),
  new EmotionResonanceBehavior(),
  new IdleChatBehavior(),
  new FarewellBehavior(),
  new FavorabilityMilestoneBehavior(),
  new PerceptionResponseBehavior(),
  new InteractionResponseBehavior(),
];
