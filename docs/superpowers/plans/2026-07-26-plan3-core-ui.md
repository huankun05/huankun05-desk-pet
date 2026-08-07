# Plan 3: 核心 UI 改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 借鉴 AIRI 的 UI 设计，改造桌宠主窗口工具栏、聊天界面、设置/状态面板，让 UI 像 AIRI 一样精致，主题切换可见。

**Architecture:** 复用 Plan 1 建立的 CSS 变量 token 系统和主题系统，将硬编码颜色替换为 `var(--xxx)`，新增 iOS 抽屉式工具栏组件，重做聊天消息组件，设置面板主题化。

**Tech Stack:** React, TypeScript, CSS Variables, framer-motion（已有）, @iconify/react + @iconify-json/solar

---

## 文件结构

**新增**：
- `src/components/Pet/ControlsIsland.tsx` — iOS 抽屉式工具栏
- `src/components/Chat/MessageItem.tsx` — 消息项（用户/AI 变体）
- `src/components/Chat/ToolCallBlock.tsx` — 工具调用展示块
- `src/components/ui/Collapsible.tsx` — 折叠组件
- `src/components/ui/PageHeader.tsx` — 页面头部

**修改**：
- `src/App.tsx` — 替换工具栏为 ControlsIsland
- `src/components/Settings/SettingsPanelWindow.tsx` — 主题化（关键颜色用 var）
- `src/components/Settings/SettingsPanel.tsx` — 主题化 + 主题切换入口
- `src/components/Chat/ChatWindow.tsx` — 用 MessageItem 重做
- `src/components/Status/StatusPanel.tsx` — 主题化

---

## Task 1: 安装图标库

- [ ] **Step 1: 安装 @iconify/react 和 solar 图标集**

```bash
cd f:\Work\Create\desk_pet\desk-pet
pnpm add @iconify/react @iconify-json/solar
```

- [ ] **Step 2: 验证安装**

```bash
pnpm typecheck 2>&1 | Select-String "iconify" | Select-Object -First 5
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @iconify/react and solar icon set"
```

---

## Task 2: iOS 抽屉式工具栏（ControlsIsland）

**Files:**
- Create: `src/components/Pet/ControlsIsland.tsx`

借鉴 AIRI 的 controls-island 设计：固定右下角，主按钮 + 展开面板，展开动画用 `cubic-bezier(0.32, 0.72, 0, 1)`，鼠标离开 1.5s 自动折叠。

- [ ] **Step 1: 实现 ControlsIsland 组件**

```typescript
// src/components/Pet/ControlsIsland.tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { createPortal } from 'react-dom';

interface ControlsIslandProps {
  onSettings: () => void;
  onChat: () => void;
  onRefresh: () => void;
  onCenter: () => void;
  onToggleTheme: () => void;
  onToggleTop: () => void;
  onToggleLock: () => void;
  onExit: () => void;
  isTop: boolean;
  isLocked: boolean;
}

export function ControlsIsland(props: ControlsIslandProps) {
  const [expanded, setExpanded] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    setExpanded(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };
  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setExpanded(false), 1500);
  };

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const buttons = [
    { icon: 'solar:settings-linear', label: '设置', onClick: props.onSettings },
    { icon: 'solar:chat-round-dots-linear', label: '聊天', onClick: props.onChat },
    { icon: 'solar:refresh-circle-linear', label: '刷新', onClick: props.onRefresh },
    { icon: 'solar:target-linear', label: '居中', onClick: props.onCenter },
    { icon: 'solar:pallete-2-linear', label: '主题', onClick: props.onToggleTheme },
    { icon: props.isTop ? 'solar:eye-linear' : 'solar:eye-closed-linear', label: '置顶', onClick: props.onToggleTop },
    { icon: props.isLocked ? 'solar:lock-keyhole-linear' : 'solar:lock-keyhole-unlocked-linear', label: '锁定', onClick: props.onToggleLock },
    { icon: 'solar:power-linear', label: '退出', onClick: props.onExit },
  ];

  return createPortal(
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
      }}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      {/* 展开的按钮面板 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 36px)',
          gap: 6,
          opacity: expanded ? 1 : 0,
          transform: expanded ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.9)',
          filter: expanded ? 'blur(0)' : 'blur(4px)',
          transition: 'opacity 250ms cubic-bezier(0.32, 0.72, 0, 1), transform 250ms cubic-bezier(0.32, 0.72, 0, 1), filter 250ms cubic-bezier(0.32, 0.72, 0, 1)',
          pointerEvents: expanded ? 'auto' : 'none',
        }}
      >
        {buttons.map((b) => (
          <button
            key={b.label}
            onClick={b.onClick}
            title={b.label}
            style={{
              width: 36,
              height: 36,
              border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
              borderRadius: 'var(--radius-md, 12px)',
              background: 'var(--bg-glass, rgba(255,255,255,0.55))',
              backdropFilter: 'blur(12px)',
              color: 'var(--text-primary, #1a1a2e)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 150ms',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-soft, rgba(255,127,172,0.12))'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-glass, rgba(255,255,255,0.55))'}
          >
            <Icon icon={b.icon} width={18} height={18} />
          </button>
        ))}
      </div>
      {/* 主按钮 */}
      <button
        onClick={() => setExpanded(!expanded)}
        title="控制面板"
        style={{
          width: 44,
          height: 44,
          border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
          borderRadius: 'var(--radius-full, 9999px)',
          background: 'var(--bg-glass, rgba(255,255,255,0.55))',
          backdropFilter: 'blur(12px)',
          color: 'var(--accent, #FF7FAC)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}
      >
        <Icon icon="solar:widget-4-linear" width={22} height={22} />
      </button>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Pet/ControlsIsland.tsx
git commit -m "feat(ui): add iOS-style controls island with solar icons"
```

---

## Task 3: 在 App.tsx 中替换工具栏

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 导入并替换工具栏**

在 App.tsx 中找到现有工具栏代码（搜索 toolbar 或 emoji 按钮），替换为 `<ControlsIsland ... />`。

具体替换位置需读取 App.tsx 后确定。保留原有的 onSettings/onChat 等回调逻辑，只替换 UI 部分。

- [ ] **Step 2: 验证 + Commit**

```bash
pnpm typecheck 2>&1 | Select-String "App.tsx|error TS" | Select-Object -First 10
git add src/App.tsx
git commit -m "feat(ui): replace toolbar with ControlsIsland"
```

---

## Task 4: SettingsPanel 主题化

**Files:**
- Modify: `src/components/Settings/SettingsPanel.tsx`
- Modify: `src/components/Settings/SettingsPanelWindow.tsx`

将硬编码颜色（如 `rgba(255,255,255,0.8)`、`#1a1a2e`、`#FF7FAC`）替换为 CSS 变量（`var(--bg-glass)`、`var(--text-primary)`、`var(--accent)`）。

- [ ] **Step 1: 读取 SettingsPanel.tsx，识别所有硬编码颜色**

```bash
# 查找硬编码颜色
```

- [ ] **Step 2: 批量替换为 CSS 变量**

替换规则：
- `rgba(255, 255, 255, 0.8)` / `rgba(255,255,255,0.8)` → `var(--bg-glass)`
- `rgba(0, 0, 0, 0.5)` → `var(--bg-glass-dark)`
- `#1a1a2e` / `#1a1a2e` → `var(--text-primary)`
- `#6b7280` → `var(--text-secondary)`
- `#FF7FAC` / `#ff7fac` → `var(--accent)`
- `rgba(255, 127, 172, 0.2)` → `var(--accent-soft)`
- `1px solid rgba(255,255,255,0.1)` → `1px solid var(--border)`

- [ ] **Step 3: 在 SettingsPanel 顶部加主题切换入口**

复用 Plan 1 Task 11 的主题切换 UI（预设按钮 + 亮/暗切换），放在 SettingsPanel 顶部。

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm typecheck 2>&1 | Select-String "SettingsPanel|error TS" | Select-Object -First 10
git add src/components/Settings/
git commit -m "feat(ui): theme-ize SettingsPanel with CSS variables"
```

---

## Task 5: 聊天消息组件（MessageItem）

**Files:**
- Create: `src/components/Chat/MessageItem.tsx`

- [ ] **Step 1: 实现消息变体组件**

```typescript
// src/components/Chat/MessageItem.tsx
import { Icon } from '@iconify/react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  toolCalls?: Array<{ name: string; input: unknown; output: unknown }>;
}

interface MessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
  onDelete?: () => void;
}

export function MessageItem({ message, onRetry, onDelete }: MessageItemProps) {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '4px 12px',
        animation: 'message-enter 250ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <div
        style={{
          maxWidth: '75%',
          padding: '8px 12px',
          borderRadius: isUser ? 'var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-lg)' : 'var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)',
          background: isUser ? 'var(--accent-soft)' : 'var(--bg-glass)',
          color: 'var(--text-primary)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--glass-border)',
          fontSize: '13px',
          lineHeight: 1.5,
          position: 'relative',
          group: 'message',
        }}
      >
        {message.content}
        {message.isStreaming && (
          <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>▋</span>
        )}
        {/* hover 操作菜单 */}
        <div style={{
          position: 'absolute',
          top: -28,
          right: 0,
          display: 'flex',
          gap: 4,
          opacity: 0,
          transition: 'opacity 150ms',
        }} className="message-actions">
          {onRetry && (
            <button onClick={onRetry} title="重试" style={iconBtnStyle}>
              <Icon icon="solar:refresh-circle-linear" width={16} height={16} />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} title="删除" style={iconBtnStyle}>
              <Icon icon="solar:trash-bin-trash-linear" width={16} height={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 24, height: 24,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-glass)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
```

- [ ] **Step 2: 添加 hover 显示 CSS**

在 `src/index.css` 或 App.css 添加：

```css
.message:hover .message-actions { opacity: 1; }
@keyframes message-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/MessageItem.tsx src/index.css
git commit -m "feat(chat): add MessageItem with variants and hover actions"
```

---

## Task 6: 工具调用块（ToolCallBlock）

**Files:**
- Create: `src/components/Chat/ToolCallBlock.tsx`

- [ ] **Step 1: 实现工具调用展示**

```typescript
// src/components/Chat/ToolCallBlock.tsx
import { useState } from 'react';
import { Icon } from '@iconify/react';

interface ToolCallBlockProps {
  name: string;
  input: unknown;
  output: unknown;
  status: 'running' | 'success' | 'error';
}

export function ToolCallBlock({ name, input, output, status }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = {
    running: 'solar:server-square-cloud-linear',
    success: 'solar:check-circle-linear',
    error: 'solar:close-circle-linear',
  }[status];
  const statusColor = {
    running: 'var(--text-secondary)',
    success: '#10b981',
    error: '#ef4444',
  }[status];

  return (
    <div style={{
      margin: '4px 0',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-surface)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', padding: '6px 10px',
          border: 'none', background: 'transparent',
          color: 'var(--text-primary)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: '12px',
        }}
      >
        <Icon icon={statusIcon} width={14} height={14} color={statusColor} />
        <span style={{ fontWeight: 500 }}>{name}</span>
        <Icon icon={expanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'} width={12} height={12} style={{ marginLeft: 'auto' }} />
      </button>
      {expanded && (
        <div style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--glass-border)' }}>
          <div style={{ marginBottom: 4 }}>
            <strong>输入:</strong>
            <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(input, null, 2)}</pre>
          </div>
          {output !== undefined && (
            <div>
              <strong>输出:</strong>
              <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(output, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Chat/ToolCallBlock.tsx
git commit -m "feat(chat): add ToolCallBlock for MCP tool display"
```

---

## Task 7: ChatWindow 集成新组件

**Files:**
- Modify: `src/components/Chat/ChatWindow.tsx`

- [ ] **Step 1: 读取 ChatWindow.tsx，识别消息渲染部分**

- [ ] **Step 2: 用 MessageItem 替换现有消息渲染**

将现有的消息渲染逻辑替换为 `<MessageItem />` 组件，支持工具调用时插入 `<ToolCallBlock />`。

- [ ] **Step 3: 输入框增强（自动伸缩）**

替换输入框为自动伸缩的 textarea：

```typescript
const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 10 * 20) + 'px';
};
```

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm typecheck 2>&1 | Select-String "ChatWindow|error TS" | Select-Object -First 10
git add src/components/Chat/ChatWindow.tsx
git commit -m "feat(chat): integrate MessageItem and ToolCallBlock"
```

---

## Task 8: StatusPanel 主题化

**Files:**
- Modify: `src/components/Status/StatusPanel.tsx`

- [ ] **Step 1: 读取 StatusPanel.tsx**

- [ ] **Step 2: 替换硬编码颜色为 CSS 变量**

同 Task 4 的替换规则。情绪色条和好感度进度条改用 `var(--accent)` 作为主色。

- [ ] **Step 3: typecheck + Commit**

```bash
git add src/components/Status/StatusPanel.tsx
git commit -m "feat(ui): theme-ize StatusPanel with CSS variables"
```

---

## Task 9: 验证

- [ ] **Step 1: 启动应用验证**

1. 工具栏：右下角应有圆形主按钮，hover 展开 9 宫格按钮
2. 主题切换：设置面板顶部主题切换 → 整个面板颜色变化
3. 聊天：消息有左右对齐变体，hover 显示操作按钮
4. 图标：所有 emoji 替换为 Solar 线性图标

---

## 验收标准

- [ ] 工具栏改为 iOS 抽屉式，自动折叠
- [ ] 聊天界面消息变体、工具调用块、输入框增强
- [ ] 设置/状态面板主题化，主题切换有可见效果
- [ ] 所有 emoji 图标替换为 Solar 图标
- [ ] typecheck 无新增错误
- [ ] 主观感受：UI 像 AIRI 一样精致
