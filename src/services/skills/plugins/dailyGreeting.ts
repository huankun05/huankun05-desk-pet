import { DeskPetPlugin } from '../base';
import type { PluginConfigSchema } from '../types';

const CONFIG_SCHEMA: PluginConfigSchema = {
  type: 'object',
  properties: {
    morningGreeting: {
      type: 'boolean',
      title: '早安问候',
      description: '每天早上自动打招呼',
      default: true,
    },
    morningTime: {
      type: 'string',
      title: '早安时间',
      description: '早安问候的触发时间 (HH:MM)',
      default: '08:00',
    },
    eveningGreeting: {
      type: 'boolean',
      title: '晚安问候',
      description: '每天晚上自动道晚安',
      default: true,
    },
    eveningTime: {
      type: 'string',
      title: '晚安时间',
      description: '晚安问候的触发时间 (HH:MM)',
      default: '23:00',
    },
    holidayGreeting: {
      type: 'boolean',
      title: '节日祝福',
      description: '重要节日送上祝福',
      default: true,
    },
  },
  required: [],
};

export class DailyGreetingPlugin extends DeskPetPlugin {
  private lastGreetingDay = '';
  private lastEveningDay = '';
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'daily-greeting',
      name: '每日问候',
      version: '1.0.0',
      description: '每天早晚和节日送上温馨问候，让宠物更有陪伴感',
      icon: '🌅',
      author: 'DeskPet Team',
      configSchema: CONFIG_SCHEMA,
      isBuiltin: true,
      enabled: true,
    });
  }

  protected onInitialize(): void {
    this.startCheckTimer();
  }

  protected onTerminate(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private startCheckTimer(): void {
    this.checkTimer = setInterval(() => this.checkTime(), 60000);
  }

  private checkTime(): void {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    const dateKey = now.toDateString();

    const morningTime = this.getConfig('morningTime', '08:00');
    const eveningTime = this.getConfig('eveningTime', '23:00');

    if (
      this.getConfig('morningGreeting', true) &&
      timeStr === morningTime &&
      this.lastGreetingDay !== dateKey
    ) {
      this.lastGreetingDay = dateKey;
      this.say(this.getMorningGreeting());
      this.playAnimation('Tap');
    }

    if (
      this.getConfig('eveningGreeting', true) &&
      timeStr === eveningTime &&
      this.lastEveningDay !== dateKey
    ) {
      this.lastEveningDay = dateKey;
      this.say(this.getEveningGreeting());
      this.playAnimation('Idle');
    }

    if (this.getConfig('holidayGreeting', true)) {
      const holiday = this.checkHoliday(now);
      if (holiday && timeStr === '09:00' && this.lastGreetingDay !== `holiday-${dateKey}`) {
        this.lastGreetingDay = `holiday-${dateKey}`;
        this.say(holiday);
        this.playAnimation('Tap');
      }
    }
  }

  private getMorningGreeting(): string {
    const greetings = [
      '早上好呀！新的一天开始啦~',
      '早安！今天也要元气满满哦！',
      '起床啦起床啦，美好的一天开始了！',
      '早上好~ 记得吃早餐哦！',
      '新的一天，新的开始，加油！',
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  private getEveningGreeting(): string {
    const greetings = [
      '晚安~ 今天辛苦了，好好休息吧！',
      '早点睡哦，明天见！',
      '晚安好梦~ 记得盖好被子！',
      '今天也辛苦了，睡个好觉吧！',
      '晚安~ 明天又是美好的一天！',
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  private checkHoliday(date: Date): string | null {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    const holidays: Record<string, string> = {
      '1-1': '新年快乐！愿新的一年一切顺利~',
      '2-14': '情人节快乐！有你陪伴真好~',
      '3-8': '女神节快乐！你是最棒的！',
      '5-1': '劳动节快乐！今天好好休息吧~',
      '6-1': '儿童节快乐！永远保持童心哦~',
      '8-15': '中秋节快乐！记得吃月饼哦~',
      '10-1': '国庆节快乐！假期愉快~',
      '12-25': '圣诞节快乐！Merry Christmas!',
    };

    return holidays[`${month}-${day}`] || null;
  }

  triggerMorning(): void {
    this.say(this.getMorningGreeting());
  }

  triggerEvening(): void {
    this.say(this.getEveningGreeting());
  }
}
