/**
 * "一起刷抖音"插件
 *
 * 将现有的一起看功能封装为插件，支持：
 * - 从市场安装/卸载
 * - 通过 PluginRegistry 管理生命周期
 * - 可配置参数（间隔时间、提示词等）
 */

import { DeskPetPlugin } from '../../services/skills/base';
import type { PluginMetadata, PluginEvent } from '../../services/skills/types';
import {
  captureScreenshot,
  analyzeScreenshot,
  DEFAULT_WATCH_PROMPT,
  type WatchTogetherResult,
} from '../../services/scenes/watchTogether';

interface WatchTogetherConfig {
  intervalMs: number;
  systemPrompt: string;
  visionDetection: 'auto' | 'manual';
  isVisionModel: boolean;
}

const DEFAULT_CONFIG: WatchTogetherConfig = {
  intervalMs: 8000,
  systemPrompt: DEFAULT_WATCH_PROMPT,
  visionDetection: 'auto',
  isVisionModel: false,
};

export class WatchTogetherPlugin extends DeskPetPlugin {
  private timerId: number | null = null;
  private isWatching = false;
  private config: WatchTogetherConfig;

  constructor() {
    const metadata: PluginMetadata = {
      id: 'watch-together',
      name: '一起刷抖音',
      version: '1.0.0',
      description: '和桌面宠物一起看屏幕，AI 实时评论画面内容',
      author: 'desk-pet',
      icon: 'solar:video-frame-bold-duotone',
      isBuiltin: true,
      enabled: false,
    };
    super(metadata);
    this.config = DEFAULT_CONFIG;
  }

  protected onInitialize(): void {
    // 加载配置
    this.config = {
      ...DEFAULT_CONFIG,
      ...this.loadData<Partial<WatchTogetherConfig>>('config', {}),
    };
    console.log('[WatchTogether] Plugin initialized', this.config);
  }

  protected onTerminate(): void {
    this.stopWatching();
  }

  protected onEvent(event: PluginEvent): void {
    // 支持通过 interaction 事件触发
    if (event.type === 'interaction:click') {
      const payload = event.payload as { action?: string } | undefined;
      if (payload?.action === 'toggle-watch') {
        this.toggleWatching();
      }
    }
  }

  /**
   * 开始/停止观看
   */
  toggleWatching(): void {
    if (this.isWatching) {
      this.stopWatching();
    } else {
      this.startWatching();
    }
  }

  startWatching(): void {
    if (this.isWatching) return;
    this.isWatching = true;
    this.showBubble('🎬 一起看模式已开启！');
    this.scheduleNextCapture();
  }

  stopWatching(): void {
    this.isWatching = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private scheduleNextCapture(): void {
    if (!this.isWatching) return;
    this.timerId = window.setTimeout(() => {
      this.captureAndAnalyze();
      this.scheduleNextCapture();
    }, this.config.intervalMs);
  }

  private async captureAndAnalyze(): Promise<void> {
    try {
      const imageDataUrl = await captureScreenshot();
      const result = await analyzeScreenshot(imageDataUrl, this.config.systemPrompt);
      this.handleResult(result);
    } catch (err) {
      console.warn('[WatchTogether] Capture failed:', err);
    }
  }

  private handleResult(result: WatchTogetherResult): void {
    this.showBubble(result.comment, 3000);
    this.playAnimation(result.expression);
    this.say(result.comment);
  }

  /**
   * 更新配置
   */
  updateConfig(partial: Partial<WatchTogetherConfig>): void {
    this.config = { ...this.config, ...partial };
    this.saveData('config', this.config);
  }

  getWatchConfig(): WatchTogetherConfig {
    return { ...this.config };
  }

  get status(): { isWatching: boolean; config: WatchTogetherConfig } {
    return { isWatching: this.isWatching, config: this.config };
  }
}

// 导出单例
export const watchTogetherPlugin = new WatchTogetherPlugin();
export default watchTogetherPlugin;
