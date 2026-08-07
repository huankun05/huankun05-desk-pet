import { DeskPetPlugin } from '../base';
import type { PluginConfigSchema } from '../types';

const CONFIG_SCHEMA: PluginConfigSchema = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      title: '开启提醒',
      description: '久坐后提醒起来活动',
      default: true,
    },
    sitDuration: {
      type: 'number',
      title: '久坐时长（分钟）',
      description: '连续坐多久后提醒',
      default: 45,
    },
    breakDuration: {
      type: 'number',
      title: '活动时长（分钟）',
      description: '建议活动的时间',
      default: 5,
    },
    remindExercise: {
      type: 'boolean',
      title: '推荐简单运动',
      description: '提醒时推荐简单的拉伸运动',
      default: true,
    },
  },
  required: [],
};

export class SedentaryReminderPlugin extends DeskPetPlugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastActivityTime = Date.now();
  private lastReminderTime = 0;

  constructor() {
    super({
      id: 'sedentary-reminder',
      name: '久坐提醒',
      version: '1.0.0',
      description: '提醒你定时站起来活动，保护颈椎和腰椎',
      icon: '🏃',
      author: 'DeskPet Team',
      configSchema: CONFIG_SCHEMA,
      isBuiltin: true,
      enabled: false,
    });
  }

  protected onInitialize(): void {
    this.startTimer();
    this.setupActivityListeners();
  }

  protected onTerminate(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startTimer(): void {
    this.timer = setInterval(() => this.checkReminder(), 60000);
  }

  private setupActivityListeners(): void {
    const activityHandler = () => {
      this.lastActivityTime = Date.now();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', activityHandler);
      window.addEventListener('keydown', activityHandler);
      window.addEventListener('click', activityHandler);
    }
  }

  private checkReminder(): void {
    if (!this.getConfig('enabled', true)) return;

    const now = Date.now();
    const sitDuration = this.getConfig('sitDuration', 45) * 60 * 1000;
    const cooldown = 30 * 60 * 1000;

    const idleTime = now - this.lastActivityTime;

    if (idleTime >= sitDuration && now - this.lastReminderTime >= cooldown) {
      this.lastReminderTime = now;
      this.say(this.getReminderMessage());
      this.playAnimation('Tap');
    }
  }

  private getReminderMessage(): string {
    const messages = [
      '坐太久啦！起来活动一下吧~',
      '该站起来走走啦，保护颈椎哦！',
      '久坐伤身，起来伸个懒腰吧！',
      '休息一下眼睛，看看远处~',
      '起来喝口水，走动走动吧！',
    ];

    const exercises = [
      '试试颈椎米字操~',
      '做几个深呼吸吧！',
      '站起来走两步~',
      '转动一下肩膀~',
      '伸个懒腰放松一下！',
    ];

    let message = messages[Math.floor(Math.random() * messages.length)];

    if (this.getConfig('remindExercise', true)) {
      const exercise = exercises[Math.floor(Math.random() * exercises.length)];
      message += ` ${exercise}`;
    }

    return message;
  }

  resetTimer(): void {
    this.lastActivityTime = Date.now();
    this.say('好的，重新计时~');
  }
}
