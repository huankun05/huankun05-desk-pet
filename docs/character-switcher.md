# 角色切换器骨架 — 设计与实施记录

> 版本：v0.1（骨架版）
> 日期：2026-09-03
> 状态：功能层完成，UI 层待后续添加

## 1. 概述

将 Cyrene 的 Live2D 模型路径从硬编码改为可配置，支持多角色切换。第一版只搭好骨架（配置层 + 模型路径动态读取），UI 选择器和热切换后续添加。

## 2. 设计方案

### 2.1 总分文件结构

为避免把角色逻辑塞进已有的超大设置文件，采用独立模块：

| 文件 | 职责 | 层级 |
|------|------|------|
| `src/shared/character-types.ts` | 角色类型定义 + 默认值 + normalize 纯函数 | 共享层（main/renderer 均可引用） |
| `src/main/character/character-manager.ts` | 角色管理器：从 settings 读取当前角色，提供查询 API | main 层 |
| `src/main/settings/general-settings.ts` | GeneralSettings 接口新增 `characters` / `currentCharacterId` 字段 | main 层 |
| `src/main/settings/settings-facade.ts` | 默认值 + normalize 逻辑集成 | main 层 |
| `src/renderer/main.ts` | Live2D 模型路径从 settings 动态读取 | renderer 层 |

### 2.2 数据结构

```typescript
interface CharacterConfig {
  id: string;           // 角色唯一 ID，如 "cyrene"
  name: string;         // 显示名称，如 "昔涟"
  modelPath: string;    // Live2D 模型相对路径（相对于 assets/models/）
  promptsDir?: string;  // 角色专属 prompts 目录（可选，第一版未使用）
}
```

GeneralSettings 新增字段：
- `characters: CharacterConfig[]` — 可用角色列表，默认 `[{ id: "cyrene", name: "昔涟", modelPath: "cyrene/Cyrene.model3.json" }]`
- `currentCharacterId: string` — 当前选中角色 ID，默认 `"cyrene"`

### 2.3 切换流程（第一版）

1. 用户修改 `general-settings.json` 中的 `currentCharacterId`（或后续通过 UI 选择）
2. 重启 Cyrene
3. `renderer/main.ts` 启动时异步读取 `window.settings.getGeneral()`
4. 从 `characters` 列表中查找 `currentCharacterId` 对应的角色
5. 用该角色的 `modelPath` 加载 Live2D 模型
6. 查找失败时回退到默认角色（昔涟）

## 3. 修改的文件清单

### 3.1 新建文件

1. **`src/shared/character-types.ts`**（2401 bytes）
   - `CharacterConfig` 接口
   - `DEFAULT_CHARACTER` / `DEFAULT_CHARACTER_ID` 常量
   - `normalizeCharacterId()` / `normalizeCharacterConfig()` / `normalizeCharacterList()` 纯函数

2. **`src/main/character/character-manager.ts`**（1475 bytes）
   - `getCurrentCharacter()` — 获取当前选中角色配置
   - `getCurrentCharacterModelPath()` — 获取当前角色模型路径
   - `getCharacterList()` — 获取所有可用角色
   - `getCurrentCharacterId()` — 获取当前角色 ID

### 3.2 修改文件

3. **`src/main/settings/general-settings.ts`**
   - 新增 `import type { CharacterConfig }`
   - GeneralSettings 接口新增 `characters: CharacterConfig[]` 和 `currentCharacterId: string` 字段（含 JSDoc 注释）

4. **`src/main/settings/settings-facade.ts`**
   - 新增 `normalizeCharacterList` / `normalizeCharacterId` / `DEFAULT_CHARACTER` / `DEFAULT_CHARACTER_ID` 导入
   - `DEFAULT_GENERAL_SETTINGS` 新增 `characters: [{ ...DEFAULT_CHARACTER }]` 和 `currentCharacterId: DEFAULT_CHARACTER_ID`
   - `normalizeGeneralSettings()` 返回对象新增 `characters: normalizeCharacterList(...)` 和 `currentCharacterId: normalizeCharacterId(...)`

5. **`src/renderer/main.ts`**
   - 从第 71 行到文件末尾的代码包装到异步 IIFE `void (async () => { ... })();`
   - IIFE 开头异步读取 `window.settings.getGeneral()`，解析当前角色的 `modelPath`
   - `modelPath` 从硬编码 `resolveAsset("models/cyrene/Cyrene.model3.json")` 改为 `resolveAsset(\`models/${modelRelativePath}\`)`
   - settings 读取失败时回退到默认角色昔涟

## 4. 验证结果

| 验证项 | 结果 |
|--------|------|
| 主进程 TypeScript 编译（tsc -p tsconfig.main.json） | 通过，零错误 |
| preload TypeScript 编译（tsc -p tsconfig.preload.json） | 通过，零错误 |
| CLI 构建 | 通过 |
| dev 模式启动 | 成功，Electron 窗口正常，无运行时错误 |
| 默认角色（昔涟）模型加载 | 正常（与修改前行为一致） |

## 5. 后续待办

### 5.1 UI 层（优先级高）
- [ ] 在设置界面添加角色选择下拉框（`src/renderer/settings/settings.ts`，该文件被作者标记为"技术债，延期重构"，添加时需谨慎）
- [ ] 下拉框选项从 `characters` 列表动态生成
- [ ] 切换后提示用户"重启生效"（第一版不支持热切换）

### 5.2 角色管理（优先级中）
- [ ] 设置界面添加角色管理 UI（增删改角色）
- [ ] 角色模型文件目录约定（`assets/models/<character-id>/`）
- [ ] 角色添加时的模型文件校验

### 5.3 热切换（优先级低）
- [ ] 运行时切换 Live2D 模型（需扩展 Live2DManager，添加 `changeModel()` 方法）
- [ ] 切换时的过渡动画

### 5.4 角色专属内容（优先级低）
- [ ] 角色专属 prompts 目录（`CharacterConfig.promptsDir` 字段已预留，需修改 `external-content-paths.ts` 的 `promptDirectories` 注入角色目录）
- [ ] 角色专属语音配置
- [ ] 角色专属情绪/人格系统

### 5.5 测试
- [ ] `character-types.ts` 的单元测试（normalize 函数边界情况）
- [ ] `character-manager.ts` 的单元测试
- [ ] 角色切换的集成测试

## 6. 配置示例

`general-settings.json` 中角色相关字段：

```json
{
  "characters": [
    {
      "id": "cyrene",
      "name": "昔涟",
      "modelPath": "cyrene/Cyrene.model3.json"
    },
    {
      "id": "custom-1",
      "name": "自定义角色",
      "modelPath": "custom-1/model.model3.json"
    }
  ],
  "currentCharacterId": "cyrene"
}
```

切换角色时，修改 `currentCharacterId` 为目标角色的 `id`，重启 Cyrene 即可生效。
