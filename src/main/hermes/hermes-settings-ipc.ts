import { IPC } from "../../shared/ipc-channels";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import {
  generateApiServerKey,
  type HermesSettings,
  type HermesSettingsPublic,
  type HermesHealthStatus,
} from "../../shared/hermes-settings-types";
import {
  getHermesSettingsPublic,
  loadHermesSettings,
  probeHermesHealth,
  saveHermesSettings,
  syncModelCredentialsToHermes,
  writeHermesModelConfig,
  writeHermesRuntimeEnv,
} from "./hermes-settings";
import { loadModelSettings } from "../settings/model-settings";

export function registerHermesSettingsIpc(deps: { ipc?: IpcScope } = {}): void {
  const ipc = deps.ipc ?? createIpcScope();

  ipc.handle(IPC.HERMES_GET_SETTINGS, async () => {
    const settings = getHermesSettingsPublic();
    const health = await probeHermesHealth();
    return { settings, health } as { settings: HermesSettingsPublic; health: HermesHealthStatus };
  });

  ipc.handle(IPC.HERMES_SAVE_SETTINGS, async (_event, patch) => {
    const saved = saveHermesSettings((patch ?? {}) as Partial<HermesSettings>);
    writeHermesRuntimeEnv(saved);
    if (saved.defaultModel || saved.modelProvider) {
      writeHermesModelConfig(saved);
    }
    return getHermesSettingsPublic();
  });

  ipc.handle(IPC.HERMES_GENERATE_KEY, async () => {
    const key = generateApiServerKey();
    const saved = saveHermesSettings({ apiServerKey: key });
    writeHermesRuntimeEnv(saved);
    return { apiServerKey: key };
  });

  ipc.handle(IPC.HERMES_WRITE_ENV, async () => writeHermesRuntimeEnv());

  ipc.handle(IPC.HERMES_SYNC_MODEL_CREDENTIALS, async () => {
    const hermes = loadHermesSettings();
    const model = loadModelSettings();
    const envResult = syncModelCredentialsToHermes(
      {
        provider: model.provider,
        apiKey: model.apiKey,
        perProvider: model.perProvider,
      },
      hermes,
    );
    writeHermesRuntimeEnv(hermes);
    const cfg = writeHermesModelConfig({
      ...hermes,
      defaultModel: hermes.defaultModel || model.model || "",
      modelProvider: hermes.modelProvider || model.provider || "",
    });
    return { ...envResult, configPath: cfg.configPath, configOk: cfg.ok };
  });

  ipc.handle(IPC.HERMES_TEST_HEALTH, async () => probeHermesHealth());
}
