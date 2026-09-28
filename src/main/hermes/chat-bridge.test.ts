import { beforeEach, describe, expect, it, vi } from "vitest";

/** chat-bridge：Chat 模式本地引擎路由的 settings 视图。 */

const currentSettings = {
  sourceDir: "",
  homeDir: "",
  uvPath: "",
  apiPort: 8642,
  apiHost: "127.0.0.1",
  apiServerKey: "gateway-key-123456",
  autoStartGateway: true,
  syncModelCredentials: true,
  defaultModel: "hermes-model",
  modelProvider: "",
  chatViaHermes: true,
};

vi.mock("electron", () => ({
  app: { getPath: () => "C:/fake/userdata", getAppPath: () => "C:/fake/app" },
}));

vi.mock("./hermes-settings", () => ({
  loadHermesSettings: () => currentSettings,
  resolveEffectiveHermesSettings: <T>(s: T) => s,
}));

import { getHermesChatSettingsView } from "./chat-bridge";

const baseSettings = {
  provider: "DeepSeek（深度求索）",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  apiKey: "sk-base",
  contextWindowTokens: 256000,
};

beforeEach(() => {
  currentSettings.chatViaHermes = true;
  currentSettings.apiServerKey = "gateway-key-123456";
  currentSettings.defaultModel = "hermes-model";
  currentSettings.apiHost = "127.0.0.1";
  currentSettings.apiPort = 8642;
});

describe("getHermesChatSettingsView", () => {
  it("开关关闭时返回 null（不路由）", () => {
    currentSettings.chatViaHermes = false;
    expect(getHermesChatSettingsView(baseSettings)).toBeNull();
  });

  it("无 API_SERVER_KEY 时返回 null（网关强制要求凭据）", () => {
    currentSettings.apiServerKey = "";
    expect(getHermesChatSettingsView(baseSettings)).toBeNull();
  });

  it("开启时覆写 provider/baseUrl/apiKey 指向网关 OpenAI 兼容端点", () => {
    const view = getHermesChatSettingsView(baseSettings);
    expect(view).toMatchObject({
      provider: "hermes",
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "gateway-key-123456",
    });
  });

  it("模型名优先用同步过的网关 defaultModel，其余字段原样保留", () => {
    const view = getHermesChatSettingsView(baseSettings);
    expect(view?.model).toBe("hermes-model");
    expect(view?.contextWindowTokens).toBe(256000);
  });

  it("网关未同步模型时回退基础模型名", () => {
    currentSettings.defaultModel = "";
    const view = getHermesChatSettingsView(baseSettings);
    expect(view?.model).toBe("deepseek-v4-pro");
  });

  it("自定义 host/port 反映到 baseUrl", () => {
    currentSettings.apiHost = "0.0.0.0";
    currentSettings.apiPort = 9000;
    const view = getHermesChatSettingsView(baseSettings);
    expect(view?.baseUrl).toBe("http://0.0.0.0:9000/v1");
  });
});
