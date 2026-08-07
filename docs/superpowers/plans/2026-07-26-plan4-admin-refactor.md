# Plan 4: 管理后台重构

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 解决管理后台 4 痛点（功能/交互/展示/性能），聚焦性能修复（轮询改事件）、KeepAlive LRU、关键页面主题化，让后台运行更流畅、主题可切换。

**Architecture:** 修复 admin 前端的疯狂轮询（改为 storage 事件 + 按需请求），KeepAlive 限制缓存数量，admin 页面引入 Plan 1 的 token 系统实现主题切换。

**Tech Stack:** React, TypeScript, Zustand, CSS Variables, @tanstack/react-virtual

---

## 文件结构

**修改**：
- `src/admin/App.tsx` — KeepAlive LRU、主题引入
- `src/admin/main.tsx` — 已有 ThemeProvider（Plan 1）
- `src/admin/pages/Dashboard.tsx` — 轮询改事件、数据可视化
- `src/admin/pages/Settings.tsx` — 主题切换入口
- `src/admin/components/` — 通用组件主题化
- `src/admin/index.css` — 引入 tokens.css

---

## Task 1: 修复 admin 疯狂轮询

**Files:**
- Modify: `src/admin/App.tsx`（或具体轮询位置）

**问题**：后台日志显示 admin 每秒多次轮询 `/api/state` 和 `/api/stats`。

- [ ] **Step 1: 定位轮询代码**

```bash
# 在 admin 下搜索 setInterval / setTimeout / polling
```

- [ ] **Step 2: 改为 storage 事件 + 按需请求**

策略：
- 状态数据（emotion/favorability）改用 `storage` 事件同步（桌宠主窗口写入 localStorage 时触发）
- 统计数据（/api/stats）改为 30 秒一次的低频轮询，页面不可见时暂停
- Dashboard 数据用 `visibilitychange` 控制刷新

- [ ] **Step 3: 验证 + Commit**

```bash
# 启动应用，观察后台日志，轮询频率应从每秒多次降到 30s 一次
git add src/admin/
git commit -m "perf(admin): replace aggressive polling with storage events + low-freq stats"
```

---

## Task 2: KeepAlive LRU 淘汰

**Files:**
- Modify: `src/admin/App.tsx`

**问题**：KeepAlive 缓存所有访问过的页面，长时间使用后内存占用高。

- [ ] **Step 1: 实现 LRU 淘汰**

修改 KeepAlive 配置，限制最大缓存数（如 5），超过时淘汰最久未访问的。

```typescript
// 伪代码
const MAX_CACHE = 5;
const [cacheOrder, setCacheOrder] = useState<string[]>([]);

const onRouteChange = (path: string) => {
  setCacheOrder(prev => {
    const filtered = prev.filter(p => p !== path);
    const next = [path, ...filtered];
    if (next.length > MAX_CACHE) next.pop();
    return next;
  });
};
```

- [ ] **Step 2: typecheck + Commit**

```bash
git add src/admin/App.tsx
git commit -m "perf(admin): add LRU eviction to KeepAlive (max 5 cached pages)"
```

---

## Task 3: Admin 主题系统接入

**Files:**
- Modify: `src/admin/index.css`
- Modify: `src/admin/pages/Settings.tsx`

- [ ] **Step 1: 在 admin/index.css 引入 tokens**

```css
@import '../ui/tokens.css';

/* admin 特有的覆盖 */
:root {
  --admin-sidebar-width: 240px;
}
```

- [ ] **Step 2: 在 Settings 页面添加主题切换入口**

复用 Plan 1 的主题切换 UI，但 scope='admin'（独立存储）。

- [ ] **Step 3: 关键页面主题化**

将 Dashboard、Settings、Providers 等页面的硬编码颜色替换为 CSS 变量。

- [ ] **Step 4: typecheck + Commit**

```bash
git add src/admin/
git commit -m "feat(admin): integrate theme system with token variables"
```

---

## Task 4: 虚拟滚动（长列表）

**Files:**
- Modify: `src/admin/pages/` 下有长列表的页面
- Install: `@tanstack/react-virtual`

- [ ] **Step 1: 安装 react-virtual**

```bash
pnpm add @tanstack/react-virtual
```

- [ ] **Step 2: 在长列表页面应用**

识别 admin 下的长列表（如插件列表、日志查看、消息历史），用 `useVirtualizer` 改造。

- [ ] **Step 3: typecheck + Commit**

```bash
git add src/admin/ package.json pnpm-lock.yaml
git commit -m "perf(admin): add virtual scrolling for long lists"
```

---

## Task 5: 状态徽章统一规范

**Files:**
- Create: `src/admin/components/StatusBadge.tsx`

- [ ] **Step 1: 实现 StatusBadge 组件**

```typescript
// src/admin/components/StatusBadge.tsx
type Status = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

const STATUS_COLORS: Record<Status, string> = {
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  accent: 'var(--accent)',
  neutral: 'var(--text-secondary)',
};

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--radius-full)',
      background: `${STATUS_COLORS[status]}20`, color: STATUS_COLORS[status],
      fontSize: '11px', fontWeight: 500,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[status] }} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: 在关键页面替换硬编码徽章**

- [ ] **Step 3: Commit**

```bash
git add src/admin/components/StatusBadge.tsx src/admin/pages/
git commit -m "feat(admin): unify status badges with StatusBadge component"
```

---

## Task 6: 空状态组件

**Files:**
- Create: `src/admin/components/EmptyState.tsx`

- [ ] **Step 1: 实现 EmptyState**

```typescript
// src/admin/components/EmptyState.tsx
import { Icon } from '@iconify/react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon = 'solar:box-linear', title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '48px 24px', color: 'var(--text-secondary)', textAlign: 'center',
    }}>
      <Icon icon={icon} width={48} height={48} style={{ opacity: 0.4, marginBottom: 12 }} />
      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>{title}</div>
      {description && <div style={{ fontSize: '12px' }}>{description}</div>}
      {action && (
        <button onClick={action.onClick} style={{
          marginTop: 12, padding: '6px 16px',
          border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)',
          background: 'var(--accent-soft)', color: 'var(--accent)',
          cursor: 'pointer', fontSize: '12px',
        }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在列表页空数据时使用**

- [ ] **Step 3: Commit**

```bash
git add src/admin/components/EmptyState.tsx src/admin/pages/
git commit -m "feat(admin): add EmptyState component for empty data display"
```

---

## Task 7: 验证

- [ ] **Step 1: 启动应用验证**

1. 后台日志：轮询频率从每秒多次降到 30s 一次
2. 主题切换：admin 设置页切换主题，整个后台颜色变化
3. 长时间使用：KeepAlive 缓存不超过 5 个页面
4. 长列表：滚动流畅

---

## 验收标准

- [ ] 轮询频率显著降低（从每秒多次到 30s 一次）
- [ ] KeepAlive LRU 淘汰工作正常
- [ ] admin 主题切换有可见效果
- [ ] 长列表虚拟滚动生效
- [ ] 状态徽章统一
- [ ] 空状态设计优化
- [ ] typecheck 无新增错误
- [ ] 主观感受：后台功能完善、操作顺手
