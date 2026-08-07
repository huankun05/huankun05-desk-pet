# Live2D Models

## 如何添加 Live2D 模型

### 1. 获取模型文件

您可以从以下来源获取 Live2D 模型：

- **Live2D 官方示例**: https://www.live2d.com/download/sample-data/
- **Booth.pm**: https://booth.pm/ (搜索 "Live2D model")
- **DeviantArt**: https://www.deviantart.com/tag/live2d
- **GitHub**: 搜索 "live2d model"

### 2. 模型文件结构

Live2D 模型通常包含以下文件：

```
model_name/
├── model_name.model3.json      # 模型配置文件 (Cubism 3/4)
├── model_name.model.json       # 模型配置文件 (Cubism 2)
├── model_name.moc3             # 模型数据 (Cubism 3/4)
├── model_name.moc              # 模型数据 (Cubism 2)
├── model_name.physics3.json    # 物理模拟配置
├── model_name.pose3.json       # 姿势配置
├── textures/                   # 纹理文件
│   ├── texture_00.png
│   └── ...
├── motions/                    # 动作文件
│   ├── Idle.motion3.json
│   └── ...
└── expressions/                # 表情文件
    ├── happy.exp3.json
    └── ...
```

### 3. 放置模型

将模型文件夹放在 `public/models/` 目录下：

```
public/
└── models/
    ├── haru/                  # 示例模型
    │   ├── haru_greeter_t03.model3.json
    │   └── ...
    └── your_model/            # 您的模型
        ├── model.model3.json
        └── ...
```

### 4. 更新配置

在 `src/App.tsx` 中更新模型路径：

```tsx
<Live2DViewer
  modelPath="/models/your_model/model.model3.json"
  emotion={live2dEmotion}
/>
```

## 推荐的免费模型

### Cubism 4 格式 (推荐)

1. **Haru** - Live2D 官方示例角色
   - 下载: https://www.live2d.com/download/sample-data/
   - 文件: `Samples/Haru/Haru.zip`

2. **Shizuku** - 可爱的女孩角色
   - 下载: https://www.live2d.com/download/sample-data/

3. **Mao** - 猫耳女孩
   - 下载: https://www.live2d.com/download/sample-data/

### Cubism 2 格式

1. **Rin** - 初音未来风格
2. **Neru** - 另一个虚拟歌手

## 模型动作和表情

确保您的模型包含以下动作和表情（用于情感系统）：

### 必需的动作
- `Idle` - 待机动画
- `TapBody` - 点击身体的反应

### 推荐的表情
- `default` - 默认表情
- `happy` - 开心
- `sad` - 难过
- `thinking` - 思考
- `surprised` - 惊讶

如果模型缺少这些动作/表情，Live2D SDK 会自动回退到默认状态。

## 故障排除

### 模型不显示

1. 检查浏览器控制台是否有错误
2. 确认模型路径正确
3. 确认模型文件完整
4. 检查 CSP 配置（需要允许加载本地资源）

### 模型加载慢

1. 压缩纹理文件
2. 减少模型复杂度
3. 使用更小的模型文件

### 动作/表情不工作

1. 检查模型是否包含这些动作
2. 查看控制台日志确认动作名称
3. 必要时修改情感系统的动作映射

## 更多资源

- [Live2D 官方文档](https://docs.live2d.com/)
- [pixi-live2d-display GitHub](https://github.com/guansss/pixi-live2d-display)
- [Live2D Cubism SDK](https://www.live2d.com/sdk/download/web/)
