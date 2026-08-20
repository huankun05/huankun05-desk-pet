/** 各 Provider 默认服务地址 */
export const DEFAULT_ENDPOINTS = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  funasr: 'http://localhost:8002',
  sensevoice: 'http://localhost:8002',
  edge_tts: 'http://localhost:8001',
  gpt_sovits: 'http://localhost:9880',
  cosyvoice: 'http://localhost:8003',
  perception_ws: 'ws://127.0.0.1:8765',
} as const;
