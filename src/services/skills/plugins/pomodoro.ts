import { DeskPetPlugin } from '../base';
import type { PluginConfigSchema } from '../types';

const CONFIG_SCHEMA: PluginConfigSchema = {
  type: 'object',
  properties: {
    workDuration: {
      type: 'number',
      title: '专注时长（分钟）',
      description: '番茄钟专注时间',
      default: 25,
    },
    breakDuration: {
      type: 'number',
      title: '休息时长（分钟）',
      description: '番茄钟休息时间',
      default: 5,
    },
    longBreakDuration: {
      type: 'number',
      title: '长休息时长（分钟）',
      description: '完成4个番茄钟后的休息时间',
      default: 15,
    },
    autoStartBreak: {
      type: 'boolean',
      title: '自动开始休息',
      description: '专注结束后自动开始休息',
      default: false,
    },
    autoStartWork: {
      type: 'boolean',
      title: '自动开始下一轮',
      description: '休息结束后自动开始下一轮专注',
      default: false,
    },
  },
  required: ['workDuration', 'breakDuration'],
};

export interface PomodoroState {
  status: 'idle' | 'working' | 'breaking' | 'long-breaking';
  currentRound: number;
  timeRemaining: number;
  totalTime: number;
}

export class PomodoroPlugin extends DeskPetPlugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: PomodoroState = {
    status: 'idle',
    currentRound: 0,
    timeRemaining: 0,
    totalTime: 0,
  };

  constructor() {
    super({
      id: 'pomodoro',
      name: '番茄钟',
      version: '1.0.0',
      description: '25分钟专注 + 5分钟休息，宠物提醒你保持专注',
      icon: '⏱️',
      author: 'DeskPet Team',
      configSchema: CONFIG_SCHEMA,
      isBuiltin: true,
      enabled: true,
    });
  }

  protected onInitialize(): void {
    this.loadState();
  }

  protected onTerminate(): void {
    this.stopTimer();
    this.saveState();
  }

  startWork(): void {
    const workDuration = this.getConfig('workDuration', 25);
    this.state = {
      status: 'working',
      currentRound: this.state.currentRound + 1,
      timeRemaining: workDuration * 60,
      totalTime: workDuration * 60,
    };
    this.startTimer();
    this.say(`开始专注吧！今天第 ${this.state.currentRound} 个番茄钟`);
    this.playAnimation('Idle');
  }

  startBreak(isLong: boolean = false): void {
    const duration = isLong
      ? this.getConfig('longBreakDuration', 15)
      : this.getConfig('breakDuration', 5);
    this.state = {
      status: isLong ? 'long-breaking' : 'breaking',
      currentRound: this.state.currentRound,
      timeRemaining: duration * 60,
      totalTime: duration * 60,
    };
    this.startTimer();
    this.say(isLong ? '辛苦了！好好休息一下吧~' : '休息时间到啦！');
    this.playAnimation('Tap');
  }

  pause(): void {
    this.stopTimer();
    this.state.status = 'idle';
    this.say('专注暂停了');
  }

  reset(): void {
    this.stopTimer();
    this.state = {
      status: 'idle',
      currentRound: 0,
      timeRemaining: 0,
      totalTime: 0,
    };
    this.saveState();
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.state.timeRemaining > 0) {
        this.state.timeRemaining--;
      } else {
        this.onTimerComplete();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private onTimerComplete(): void {
    this.stopTimer();
    this.saveState();

    if (this.state.status === 'working') {
      this.say('专注完成！');
      if (this.state.currentRound % 4 === 0) {
        if (this.getConfig('autoStartBreak', false)) {
          setTimeout(() => this.startBreak(true), 2000);
        }
      } else {
        if (this.getConfig('autoStartBreak', false)) {
          setTimeout(() => this.startBreak(false), 2000);
        }
      }
    } else {
      if (this.getConfig('autoStartWork', false)) {
        setTimeout(() => this.startWork(), 2000);
      }
    }
  }

  private saveState(): void {
    this.saveData('pomodoro-state', this.state);
  }

  private loadState(): void {
    const saved = this.loadData<PomodoroState>('pomodoro-state', {
      status: 'idle',
      currentRound: 0,
      timeRemaining: 0,
      totalTime: 0,
    });
    this.state = saved;
    if (this.state.status !== 'idle' && this.state.timeRemaining > 0) {
      this.startTimer();
    }
  }

  getState(): PomodoroState {
    return { ...this.state };
  }
}
