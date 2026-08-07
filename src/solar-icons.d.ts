// 给 tsc 的精简类型（避免直接 import 6.4MB JSON 触发字面量类型推断）。
// 运行时由 solar-icons.js 提供真实数据，Vite 打包该 JSON。
declare const solar: {
  prefix: string;
  icons: Record<string, unknown>;
  width?: number;
  height?: number;
  aliases?: Record<string, unknown>;
  not_found?: unknown[];
};

export default solar;
