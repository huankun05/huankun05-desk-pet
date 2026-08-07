import { DeskPetPlugin } from '../base';
import type { PluginConfigSchema } from '../types';

const CONFIG_SCHEMA: PluginConfigSchema = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      title: '开启护眼提醒',
      description: '定时提醒休息眼睛',
      default: false,
    },
    intervalMinutes: {
      type: 'number',
      title: '提醒间隔（分钟）',
      description: '每隔多久提醒一次护眼',
      default: 20,
    },
    restDuration: {
      type: 'number',
      title: '休息时长（秒）',
      description: '建议休息眼睛的时间',
      default: 20,
    },
    lookFar: {
      type: 'boolean',
      title: '远眺提醒',
      description: '提醒看远处放松眼睛',
      default: true,
    },
    blink: {
      type: 'boolean',
      title: '眨眼提醒',
      description: '提醒多眨眼保持眼睛湿润',
      default: true,
    },
  },
  required: [],
};

export class EyeCarePlugin extends DeskPetPlugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReminderTime = 0;

  constructor() {
    super({
      id: 'eye-care',
      name: '护眼模式',
      version: '1.0.0',
      description: '20-20-20护眼法则，定时提醒休息眼睛',
      icon: '👁️',
      author: 'DeskPet Team',
      configSchema: CONFIG_SCHEMA,
      isBuiltin: true,
      enabled: false,
    });
  }

  protected onInitialize(): void {
    this.startTimer();
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

  private checkReminder(): void {
    if (!this.getConfig('enabled', false)) return;

    const now = Date.now();
    const interval = this.getConfig('intervalMinutes', 20) * 60 * 1000;

    if (now - this.lastReminderTime >= interval) {
      this.lastReminderTime = now;
      this.say(this.getReminderMessage());
      this.playAnimation('Idle');
    }
  }

  private getReminderMessage(): string {
    const duration = this.getConfig('restDuration', 20);
    let message = `该休息眼睛啦！用 ${duration} 秒看看远处吧~`;

    const tips: string[] = [];
    if (this.getConfig('lookFar', true)) {
      tips.push('看6米以外的地方');
    }
    if (this.getConfig('blink', true)) {
      tips.push('多眨眨眼');
    }

    if (tips.length > 0) {
      message += ` 记得${tips.join('，')}哦！`;
    }

    return message;
  }

  resetNow(): void {
    this.lastReminderTime = Date.now();
    this.say('好的，重新计时~');
  }
}
