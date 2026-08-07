/**
 * 插件模板生成器
 *
 * 帮助用户快速创建自定义插件：
 * - 生成标准插件目录结构
 * - 填写 manifest.json
 * - 基于模板生成 index.ts
 */

import { createStorage } from '../storage';

const PLUGINS_DIR = 'plugins';
const _MANIFEST_FILE = 'manifest.json';
const _INDEX_FILE = 'index.ts';

interface PluginTemplate {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: 'feature' | 'behavior' | 'tool';
  permissions: string[];
  features: {
    onInitialize: boolean;
    onTerminate: boolean;
    onEvent: boolean;
    onSchedule: boolean;
    configPage: boolean;
  };
}

const DEFAULT_TEMPLATE: PluginTemplate = {
  id: '',
  name: '',
  version: '1.0.0',
  description: '',
  author: '',
  category: 'feature',
  permissions: [],
  features: {
    onInitialize: true,
    onTerminate: true,
    onEvent: false,
    onSchedule: false,
    configPage: false,
  },
};

/**
 * 生成插件代码
 */
export function generatePluginCode(template: PluginTemplate): string {
  const { id, name, version, description, author, permissions, features } = template;

  const imports = [
    "import { DeskPetPlugin } from '../../../services/skills/base';",
    "import type { PluginMetadata, PluginEvent } from '../../../services/skills/types';",
    '',
  ].join('\n');

  const metadata = `    const metadata: PluginMetadata = {
      id: '${id}',
      name: '${name}',
      version: '${version}',
      description: '${description}',
      author: '${author}',
      icon: 'solar:widget-5-bold-duotone',
      isBuiltin: false,
      enabled: true,
    };`;

  const _permissionList = JSON.stringify(permissions, null, 6);

  const methods: string[] = [];

  if (features.onInitialize) {
    methods.push(`
  protected onInitialize(): void {
    // 插件初始化逻辑
    this.showBubble('${name} 已加载', 2000);
  }`);
  }

  if (features.onTerminate) {
    methods.push(`
  protected onTerminate(): void {
    // 插件清理逻辑
  }`);
  }

  if (features.onEvent) {
    methods.push(`
  protected onEvent(event: PluginEvent): void {
    switch (event.type) {
      case 'interaction:click':
        // 处理点击事件
        break;
      case 'chat:message':
        // 处理聊天消息
        break;
      default:
        break;
    }
  }`);
  }

  if (features.onSchedule) {
    methods.push(`
  /**
   * 定时任务回调
   */
  private async onScheduledTask(): Promise<void> {
    // 执行定时任务
    this.showBubble('定时任务执行中...', 2000);
  }`);
  }

  const classDefinition = `export class ${toClassName(id)}Plugin extends DeskPetPlugin {
    constructor() {
${metadata}
    super(metadata);
  }
${methods.join('\n')}
}`;

  const exportPart = `
// 导出单例
export default new ${toClassName(id)}Plugin();
`;

  return `${imports}${classDefinition}${exportPart}`;
}

/**
 * 生成 manifest.json 内容
 */
export function generateManifest(template: PluginTemplate): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    version: template.version,
    description: template.description,
    author: template.author,
    category: template.category,
    permissions: template.permissions,
    entry: 'index.ts',
    minAppVersion: '0.1.0',
  };
}

/**
 * 保存插件到本地
 */
export async function savePlugin(template: PluginTemplate): Promise<boolean> {
  try {
    const code = generatePluginCode(template);
    const manifest = generateManifest(template);

    // 使用 storage 保存（模拟文件系统）
    const pluginStorage = createStorage<{ code: string; manifest: typeof manifest }>(
      `${PLUGINS_DIR}/${template.id}`,
      { code, manifest },
      { location: 'project', subdir: PLUGINS_DIR },
    );

    pluginStorage.set({ code, manifest });
    return true;
  } catch {
    return false;
  }
}

/** savePlugin 写入的本地插件存储结构 */
type StoredLocalPlugin = { manifest?: Record<string, unknown> | null };

/**
 * 加载本地插件
 *
 * 扫描本地存储（key 前缀 `deskpet_plugins/`，与 savePlugin 的写入位置一致）
 * 中已保存的自写插件，从其 manifest 重建 PluginTemplate 列表。
 */
export function loadLocalPlugins(): PluginTemplate[] {
  try {
    const templates: PluginTemplate[] = [];
    const prefix = 'deskpet_plugins/';
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let parsed: StoredLocalPlugin;
      try {
        parsed = JSON.parse(raw) as StoredLocalPlugin;
      } catch {
        continue;
      }
      const m = parsed.manifest;
      if (!m || typeof m.id !== 'string') continue;
      templates.push({
        id: String(m.id),
        name: typeof m.name === 'string' ? m.name : '',
        version: typeof m.version === 'string' ? m.version : '1.0.0',
        description: typeof m.description === 'string' ? m.description : '',
        author: typeof m.author === 'string' ? m.author : '',
        category: (m.category as PluginTemplate['category']) ?? 'feature',
        permissions: Array.isArray(m.permissions) ? (m.permissions as string[]) : [],
        features: { ...DEFAULT_TEMPLATE.features },
      });
    }
    return templates;
  } catch {
    return [];
  }
}

/**
 * 验证插件 ID 格式
 */
export function validatePluginId(id: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(id) && id.length >= 2 && id.length <= 50;
}

/**
 * 转换为类名
 */
function toClassName(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export { DEFAULT_TEMPLATE };
export type { PluginTemplate };
