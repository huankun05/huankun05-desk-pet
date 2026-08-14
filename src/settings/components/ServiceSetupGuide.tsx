import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';

export interface SetupEngineInfo {
  /** 与 provider 注册表一致的 typeName，例如 edge_tts / gpt_sovits */
  typeName: string;
  displayName: string;
  /** 是否需要本地模型权重（决定显示「需权重」标签 + 打开权重文件夹按钮）*/
  needsWeights: boolean;
  /** 相对应用根的权重目录（用于 open_server_dir），无则留空 */
  weightsDir?: string;
}

export interface ServiceSetupGuideProps {
  title: string;
  intro: string;
  engines: SetupEngineInfo[];
  onAdd: () => void;
  onOpenWeights?: (typeName: string) => void;
}

/**
 * 服务未配置时的「指引」空状态面板。
 * 打包产物不含任何模型权重，首次进入服务页应引导用户了解各引擎所需资源，
 * 并可直接打开权重文件夹 / 进入添加流程。
 */
export function ServiceSetupGuide({
  title,
  intro,
  engines,
  onAdd,
  onOpenWeights,
}: ServiceSetupGuideProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border-2 border-dashed border-neutral-200 bg-white p-5 animate-[fade-in-up_0.3s_ease-out]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-50)] text-[var(--primary-500)]">
          <Icon icon="solar:notebook-bookmark-bold-duotone" className="text-xl" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">{intro}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          {t('settings.services.setup_guide_engines')}
        </div>
        <ul className="space-y-2">
          {engines.map((e) => {
            const reqKey = `settings.services.engine_req.${e.typeName}`;
            const reqText = t(reqKey);
            const requirement = reqText === reqKey ? '' : reqText;
            return (
              <li
                key={e.typeName}
                className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-800">{e.displayName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        e.needsWeights ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'
                      }`}
                    >
                      {e.needsWeights
                        ? t('settings.services.engine_tag_weights')
                        : t('settings.services.engine_tag_online')}
                    </span>
                  </div>
                  {requirement && (
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">{requirement}</p>
                  )}
                </div>
                {e.needsWeights && e.weightsDir && onOpenWeights && (
                  <button
                    type="button"
                    onClick={() => onOpenWeights(e.typeName)}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-[var(--primary-300)] hover:text-[var(--primary-500)]"
                    title={t('settings.services.open_weights_folder')}
                  >
                    <Icon icon="solar:folder-with-files-bold" className="text-sm" />
                    {t('settings.services.open_weights_folder_short')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--primary-500)] py-3 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
      >
        <Icon icon="solar:add-circle-bold" className="text-base" />
        {t('settings.services.add_first_service')}
      </button>
    </div>
  );
}

export default ServiceSetupGuide;
