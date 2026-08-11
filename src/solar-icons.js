// 运行时包裹：导入 solar 图标集 JSON 供 Vite 打包。
// 用 .js（而非 .ts）是为了让 tsc（allowJs:false）完全忽略本文件，
// 从而不对该 6.4MB JSON 做字面量类型推断（否则 tsc 内存/耗时爆炸）。
// 配套 solar-icons.d.ts 仅给 tsc 提供精简类型。
import solar from './solar-icons-custom/icons.json';

export default solar;
