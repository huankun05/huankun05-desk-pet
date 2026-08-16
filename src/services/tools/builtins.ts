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

  // ===== P2：本地操作工具（经 PermissionManager 授权网关） =====

  toolRegistry.register({
    name: 'get_time',
    description:
      '获取当前系统日期和时间。当用户问"现在几点"、"今天几号"、"现在是什么时候"等场景时使用。返回本地时间字符串。',
    parameters: {},
    execute: async () => {
      const now = new Date();
      return now.toLocaleString('zh-CN', { hour12: false });
    },
  });

  toolRegistry.register({
    name: 'open_app',
    description:
      '按名称启动本地应用程序（如"网易云音乐"、"微信"、"记事本"）。当用户说"打开网易云"、"启动微信"、"开个浏览器"等场景时使用。支持模糊匹配开始菜单中的应用名。',
    parameters: {
      app_name: {
        type: 'string',
        description: '要打开的应用名称（支持部分匹配，如"网易云"可匹配"网易云音乐"）',
        required: true,
      },
    },
    execute: async (args) => {
      const appName = args.app_name as string;
      await invoke('open_app', { app_name: appName });
      return `已尝试打开应用: ${appName}`;
    },
  });

  toolRegistry.register({
    name: 'open_file',
    description:
      '用系统默认程序打开指定文件（如图片、文档、视频）。当用户说"打开这个文件"、"看一下这张图"等场景时使用。',
    parameters: {
      path: {
        type: 'string',
        description: '文件完整路径',
        required: true,
      },
    },
    execute: async (args) => {
      const path = args.path as string;
      await invoke('open_file', { path });
      return `已用默认程序打开文件: ${path}`;
    },
  });

  toolRegistry.register({
    name: 'open_folder',
    description:
      '在系统文件管理器中打开指定文件夹。当用户说"打开下载目录"、"看看桌面文件夹"等场景时使用。',
    parameters: {
      path: {
        type: 'string',
        description: '文件夹完整路径',
        required: true,
      },
    },
    execute: async (args) => {
      const path = args.path as string;
      await invoke('open_path', { path });
      return `已在文件管理器中打开: ${path}`;
    },
  });

  toolRegistry.register({
    name: 'run_command',
    description:
      '在系统上执行命令行指令（高危操作，需明确授权）。仅当用户明确要求"运行命令"、"执行 xxx 命令"、"用命令行做 xxx"时使用。可返回命令的标准输出与错误输出。',
    parameters: {
      command: {
        type: 'string',
        description: '要执行的命令行指令',
        required: true,
      },
      cwd: {
        type: 'string',
        description: '命令执行的工作目录（可选）',
        required: false,
      },
      timeout_secs: {
        type: 'number',
        description: '超时秒数（1-300，默认 30）',
        required: false,
      },
    },
    execute: async (args) => {
      const command = args.command as string;
      const cwd = (args.cwd as string) ?? undefined;
      const timeoutSecs = (args.timeout_secs as number) ?? undefined;
      const result = await invoke<{ exit_code: number; stdout: string; stderr: string }>(
        'run_command',
        { command, cwd, timeout_secs: timeoutSecs },
      );
      let out = `命令退出码: ${result.exit_code}`;
      if (result.stdout) out += `\n标准输出:\n${result.stdout}`;
      if (result.stderr) out += `\n错误输出:\n${result.stderr}`;
      return out;
    },
  });

  toolRegistry.register({
    name: 'media_control',
    description:
      '控制系统媒体播放（播放/暂停、上一首、下一首、停止、静音、音量加减）。当用户说"播放音乐"、"下一首"、"暂停"、"静音"、"声音大一点"等场景时使用。作用于系统级媒体键，对任何播放器都生效。',
    parameters: {
      action: {
        type: 'string',
        description:
          '动作：play_pause(播放/暂停) / next(下一首) / prev(上一首) / stop(停止) / mute(静音) / volume_up(音量+) / volume_down(音量-)',
        enum: ['play_pause', 'next', 'prev', 'stop', 'mute', 'volume_up', 'volume_down'],
        required: true,
      },
    },
    execute: async (args) => {
      const action = args.action as string;
      await invoke('media_control', { action });
      const label: Record<string, string> = {
        play_pause: '播放/暂停',
        next: '下一首',
        prev: '上一首',
        stop: '停止',
        mute: '静音',
        volume_up: '音量增加',
        volume_down: '音量减少',
      };
      return `已发送媒体指令: ${label[action] ?? action}`;
    },
  });

  toolRegistry.register({
    name: 'write_clipboard',
    description:
      '把文本内容写入系统剪贴板。当用户说"把这段话复制到剪贴板"、"记下来…（放剪贴板）"等场景时使用。',
    parameters: {
      text: {
        type: 'string',
        description: '要写入剪贴板的文本',
        required: true,
      },
    },
    execute: async (args) => {
      const text = args.text as string;
      await invoke('write_clipboard', { text });
      return `已写入剪贴板（${text.length} 字符）`;
    },
  });

  toolRegistry.register({
    name: 'lock_screen',
    description:
      '锁定当前电脑屏幕。当用户说"锁屏"、"帮我锁住电脑"、"离开时锁屏"等场景时使用。',
    parameters: {},
    execute: async () => {
      await invoke('lock_screen');
      return '已锁定屏幕';
    },
  });

  toolRegistry.register({
    name: 'get_battery',
    description:
      '读取当前设备的电量与电源状态（笔记本显示百分比，台式机显示无电池）。当用户问"还有多少电"、"在充电吗"等场景时使用。',
    parameters: {},
    execute: async () => {
      const info = await invoke<{ percent: number | null; status: string; on_ac: boolean }>(
        'get_battery',
      );
      if (info.percent == null) {
        return `当前设备无电池（台式机），电源状态：${info.status}`;
      }
      return `电量: ${info.percent}% ｜ 状态: ${info.status}`;
    },
  });

  toolRegistry.register({
    name: 'get_volume',
    description:
      '读取当前系统主音量（0-100）。当用户问"现在音量多大"等场景时使用。',
    parameters: {},
    execute: async () => {
      const level = await invoke<number>('get_volume');
      return `当前系统音量: ${Math.round(level)}`;
    },
  });

  toolRegistry.register({
    name: 'set_volume',
    description:
      '设置系统主音量（0-100）。当用户说"把音量调到 50"、"声音大一点/小一点"（可配合 get_volume 使用）等场景时使用。',
    parameters: {
      level: {
        type: 'number',
        description: '目标音量，0-100 的整数',
        required: true,
      },
    },
    execute: async (args) => {
      const level = Number(args.level);
      if (!Number.isFinite(level) || level < 0 || level > 100) {
        return '音量需在 0-100 之间';
      }
      await invoke('set_volume', { level });
      return `已将系统音量设为: ${Math.round(level)}`;
    },
  });

  toolRegistry.register({
    name: 'notify',
    description:
      '弹出一条系统通知（Toast）。当用户说"提醒我…"、"通知我…"、"弹个提示"等场景时使用。可指定标题与内容。',
    parameters: {
      title: {
        type: 'string',
        description: '通知标题',
        required: true,
      },
      body: {
        type: 'string',
        description: '通知正文',
        required: true,
      },
    },
    execute: async (args) => {
      const title = args.title as string;
      const body = args.body as string;
      await invoke('notify', { title, body });
      return `已发送系统通知: ${title}`;
    },
  });
}
