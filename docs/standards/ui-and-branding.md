# UI 品牌与开发检查单

**产品名（冻结）**：昔涟 / Cyrene  
**包名 / userData**：`live2d-cyrene`  
**功能层名（设置）**：模型服务、存储与备份、消息渠道、语音合成、语音识别、代码辅助…  
**智能核心**：Hermes（设置里不暴露路径；随应用自动连接）  

设计：[`../design/UI-DESIGN.md`](../design/UI-DESIGN.md)  
设置现状：[`../design/settings-model-service-status.md`](../design/settings-model-service-status.md)

## 规则

1. 产品名与包名**不再改**  
2. 新 UI 用户可见处禁止 CyreneHarness 等上游术语  
3. 设置 IA：导航与 `data-panel` 一一对应  
4. 样式：优先 `settings/styles/controls.css` + `ui` token，禁止再膨胀 `settings.css`  
