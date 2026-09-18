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
  resolveEffectiveHermesSettings,
  saveHermesSettings,
  syncModelCredentialsToHermes,
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
    const hermes = resolveEffectiveHermesSettings(loadHermesSettings());
    const model = loadModelSettings();
    const result = syncModelCredentialsToHermes(
      {
        provider: model.provider,
        apiKey: model.apiKey,
        model: model.model,
        perProvider: model.perProvider,
      },
      hermes,
    );
    writeHermesRuntimeEnv(hermes);
    return { ...result, configOk: true };
  });

  ipc.handle(IPC.HERMES_TEST_HEALTH, async () => probeHermesHealth());
}
