import { addCollection } from '@iconify/react';
import solar from './solar-icons';

// 离线注册 solar 图标集：注册后所有 `solar:*` 图标本地同步渲染，无需联网。
//
// 修复两类问题：
//  1. dev 模式：控制面板/设置页图标此前走远程 API 异步 fetch，
//     首次展开时（用户第一次点击）图标尚未加载 → 一片空白，需等网络返回。
//  2. prod 模式（tauri build）：tauri.conf.json 的 CSP connect-src 未放行
//     api.iconify.design，远程 fetch 被拦截 → 图标永久不显示。
//
// 本地 @iconify-json/solar 早已作为依赖存在，只是从未通过 addCollection 注册（死依赖）。
// 全项目图标均为 solar:*（唯一非 solar 的 lucide:move 已替换为 solar:cursor-linear），
// 因此离线注册后无需任何网络请求。
addCollection(solar as Parameters<typeof addCollection>[0]);
