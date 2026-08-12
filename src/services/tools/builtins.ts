import { invoke } from '@tauri-apps/api/core';
import { toolRegistry } from './registry';

interface ClipboardContent {
  kind: 'text' | 'image';
  data: string;
}

export function registerBuiltinTools(): void {
  toolRegistry.register({
    name: 'screenshot',
    description:
      '截取当前屏幕截图并返回图片。当用户询问"屏幕上有什么"、"帮我看一下屏幕"、"截个图"等场景时使用此工具。返回 base64 编码的 JPEG 图片。',
    parameters: {},
    execute: async () => {
      const dataUrl = await invoke<string>('capture_screenshot');
      return dataUrl;
    },
  });

  toolRegistry.register({
    name: 'read_clipboard',
    description:
      '读取剪贴板内容（文本或图片）。当用户说"看看剪贴板"、"粘贴内容"、"剪贴板里有什么"等场景时使用此工具。',
    parameters: {},
    execute: async () => {
      const result = await invoke<ClipboardContent>('read_clipboard');
      if (result.kind === 'text') {
        return result.data;
      }
      return `[图片内容，大小: ${result.data.length} 字符 base64]`;
    },
  });

  toolRegistry.register({
    name: 'list_directory',
    description:
      '列出指定目录下的文件和文件夹。当用户询问"某个目录有什么"、"查看文件夹内容"等场景时使用此工具。',
    parameters: {
      path: {
        type: 'string',
        description: '目录路径',
        required: true,
      },
    },
    execute: async (args) => {
      const path = args.path as string;
      const entries = await invoke<Array<{ name: string; is_dir: boolean; size: number }>>(
        'list_directory',
        { path },
      );
      return entries
        .map((e) => `${e.is_dir ? '[DIR]' : '     '} ${e.name} (${e.size} bytes)`)
        .join('\n');
    },
  });

  toolRegistry.register({
    name: 'read_file',
    description: '读取文本文件内容。当用户说"读一下这个文件"、"查看文件内容"等场景时使用此工具。',
    parameters: {
      path: {
        type: 'string',
        description: '文件路径',
        required: true,
      },
    },
    execute: async (args) => {
      const path = args.path as string;
      return await invoke<string>('read_file_content', { path });
    },
  });

  toolRegistry.register({
    name: 'write_file',
    description: '写入文本文件内容。当用户说"帮我写个文件"、"保存内容到文件"等场景时使用此工具。',
    parameters: {
      path: {
        type: 'string',
        description: '文件路径',
        required: true,
      },
      content: {
        type: 'string',
        description: '文件内容',
        required: true,
      },
      append: {
        type: 'boolean',
        description: '是否追加模式',
        default: false,
      },
    },
    execute: async (args) => {
      const path = args.path as string;
      const content = args.content as string;
      const append = (args.append as boolean) ?? false;
      await invoke('write_file', { path, content, append });
      return `文件已${append ? '追加' : '写入'}: ${path} (${content.length} 字符)`;
    },
  });

  toolRegistry.register({
    name: 'save_to_desktop',
    description:
      '保存文件到桌面。当用户说"保存到桌面"、"放桌面"、"生成报告放桌面"等场景时使用此工具。',
    parameters: {
      filename: {
        type: 'string',
        description: '文件名（含扩展名，如 report.md）',
        required: true,
      },
      content: {
        type: 'string',
        description: '文件内容',
        required: true,
      },
    },
    execute: async (args) => {
      const filename = args.filename as string;
      const content = args.content as string;
      const desktop = await invoke<string>('get_desktop_path');
      const fullPath = `${desktop}\\${filename}`;
      await invoke('write_file', { path: fullPath, content });
      return `文件已保存到桌面: ${filename} (${content.length} 字符)`;
    },
  });

  toolRegistry.register({
    name: 'web_search',
    description:
      '联网搜索工具。仅在用户明确需要「实时 / 最新」信息时调用，例如：今日新闻、天气、股价、赛事比分、近期发生的事件、或你无法确定准确性的时事与事实。\n【不要调用】闲聊问候、情感陪伴、观点交流、或使用常识即可回答的问题——这类情况直接自然回复，不要搜索。返回前 5 条结果的标题、链接和摘要。',
    parameters: {
      query: {
        type: 'string',
        description: '搜索关键词',
        required: true,
      },
      max_results: {
        type: 'number',
        description: '最大结果数（1-10，默认 5）',
        default: 5,
      },
    },
    execute: async (args) => {
      const query = args.query as string;
      const maxResults = (args.max_results as number) ?? 5;
      const results = await invoke<Array<{ title: string; url: string; snippet: string }>>(
        'web_search',
        { query, maxResults },
      );
      if (!results || results.length === 0) {
        return `未找到与「${query}」相关的搜索结果。`;
      }
      const formatted = results.map(
        (r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`,
      );
      return `搜索「${query}」的结果：\n\n${formatted.join('\n\n')}`;
    },
  });

  toolRegistry.register({
    name: 'system_info',
    description:
      '获取系统信息（CPU、内存、磁盘）。当用户询问"电脑性能如何"、"系统状态"等场景时使用此工具。',
    parameters: {},
    execute: async () => {
      const info = {
        platform: navigator.platform,
        userAgent: navigator.userAgent.substring(0, 100) + '...',
        language: navigator.language,
        hardwareConcurrency: navigator.hardwareConcurrency,
      };
      return JSON.stringify(info, null, 2);
    },
  });

  toolRegistry.register({
    name: 'open_url',
    description:
      '用系统默认浏览器打开网址。当用户说"打开网页"、"访问某个网站"、"打开 GitHub"等场景时使用此工具。',
    parameters: {
      url: {
        type: 'string',
        description: '要打开的完整 URL（必须以 http:// 或 https:// 开头）',
        required: true,
      },
    },
    execute: async (args) => {
      const url = args.url as string;
      await invoke('open_url', { url });
      return `已在浏览器中打开: ${url}`;
    },
  });
}
