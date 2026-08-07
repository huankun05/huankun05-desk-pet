import { DeskPetPlugin } from '../base';
import type { PluginConfigSchema } from '../types';

const CONFIG_SCHEMA: PluginConfigSchema = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      title: '开启提醒',
      description: '定时提醒喝水',
      default: true,
    },
    intervalMinutes: {
      type: 'number',
      title: '提醒间隔（分钟）',
      description: '每隔多久提醒一次喝水',
      default: 60,
    },
    startTime: {
      type: 'string',
      title: '开始时间',
      description: '每天开始提醒的时间 (HH:MM)',
      default: '09:00',
    },
    endTime: {
      type: 'string',
      title: '结束时间',
      description: '每天结束提醒的时间 (HH:MM)',
      default: '21:00',
    },
    dailyGoal: {
      type: 'number',
      title: '每日目标（杯）',
      description: '每天建议喝水的杯数',
      default: 8,
    },
  },
  required: [],
};

export class WaterReminderPlugin extends DeskPetPlugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReminderTime = 0;
  private todayCount = 0;
  private todayDate = '';

  constructor() {
    super({
      id: 'water-reminder',
      name: '喝水提醒',
      version: '1.0.0',
      description: '定时提醒喝水，保持健康的饮水习惯',
      icon: '💧',
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
    if (!this.getConfig('enabled', true)) return;

    const now = new Date();
    const dateKey = now.toDateString();

    if (dateKey !== this.todayDate) {
      this.todayDate = dateKey;
      this.todayCount = 0;
    }

    const timeStr = now.toTimeString().slice(0, 5);
    const startTime = this.getConfig('startTime', '09:00');
    const endTime = this.getConfig('endTime', '21:00');

    if (timeStr < startTime || timeStr > endTime) return;

    const interval = this.getConfig('intervalMinutes', 60) * 60 * 1000;
    const nowTs = now.getTime();

    if (nowTs - this.lastReminderTime >= interval) {
      this.lastReminderTime = nowTs;
      this.say(this.getReminderMessage());
      this.playAnimation('Tap');
    }
  }

  private getReminderMessage(): string {
    const messages = [
      '该喝水啦！保持水分充足哦~',
      '喝水时间到！来一杯水吧',
      '别忘了喝水呀，对皮肤好~',
      '喝水啦喝水啦，健康生活从水开始',
      '工作再忙也要记得喝水哦！',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  drinkWater(): void {
    this.todayCount++;
    const goal = this.getConfig('dailyGoal', 8);
    if (this.todayCount >= goal) {
      this.say(`太棒了！今天已经喝了 ${this.todayCount} 杯水，达成目标！🎉`);
    } else {
      this.say(`好的~ 今天已经喝了 ${this.todayCount}/${goal} 杯水啦`);
    }
    this.playAnimation('Tap');
  }

  getTodayCount(): number {
    return this.todayCount;
  }
}
