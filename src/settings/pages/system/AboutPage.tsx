import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section } from '../../components';

const APP_VERSION = '0.1.0';

const TECH_STACK_KEYS: { labelKey: string; value: string }[] = [
  { labelKey: 'settings.about.tech_frontend', value: 'React 19 + TypeScript' },
  { labelKey: 'settings.about.tech_style', value: 'Tailwind CSS 4' },
  { labelKey: 'settings.about.tech_icon', value: '@iconify/react (Solar duotone)' },
  { labelKey: 'settings.about.tech_router', value: 'react-router-dom 7' },
  { labelKey: 'settings.about.tech_desktop', value: 'Tauri 2' },
  { labelKey: 'settings.about.tech_model', value: 'Live2D Cubism SDK' },
];

const OPEN_SOURCE_LICENSES: { name: string; license: string }[] = [
  { name: 'Tauri', license: 'MIT / Apache-2.0' },
  { name: 'React', license: 'MIT' },
  { name: 'Live2D Cubism SDK', license: 'MIT' },
];

/**
 * 系统 → 关于：应用信息 + 技术栈 + 开源许可。
 */
export function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="animate-[fade-in-up_0.3s_ease-out]">
      <Section title={t('settings.about.app_info')}>
        <div className="flex flex-col items-center px-4 py-6 text-center">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-500) 12%, white)',
              color: 'var(--primary-500)',
            }}
          >
            <Icon icon="solar:cat-bold-duotone" className="text-4xl" />
          </div>
          <h2 className="mt-3 text-lg font-semibold text-neutral-900">Desk Pet</h2>
          <p className="mt-0.5 text-xs text-neutral-500">{t('settings.about.desk_pet')}</p>
          <span className="mt-2 rounded-full bg-neutral-100 px-3 py-0.5 text-xs font-medium text-neutral-600">
            v{APP_VERSION}
          </span>
          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
            {t('settings.about.up_to_date')}
          </div>
        </div>
      </Section>

      <Section title={t('settings.about.tech_stack')}>
        <ul className="divide-y divide-neutral-100">
          {TECH_STACK_KEYS.map((item) => (
            <li
              key={item.labelKey}
              className="flex items-center justify-between px-4 py-3 first:pt-3 last:pb-3"
            >
              <span className="text-sm text-neutral-500">{t(item.labelKey)}</span>
              <span className="text-sm font-medium text-neutral-800">{item.value}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('settings.about.license')}>
        <ul className="divide-y divide-neutral-100">
          {OPEN_SOURCE_LICENSES.map((item) => (
            <li
              key={item.name}
              className="flex items-center justify-between px-4 py-3 first:pt-3 last:pb-3"
            >
              <span className="text-sm text-neutral-500">{item.name}</span>
              <span className="text-sm font-medium text-neutral-800">{item.license}</span>
            </li>
          ))}
        </ul>
      </Section>

      <p className="mt-4 text-center text-[11px] text-neutral-400">Made with ♥ — Desk Pet</p>
    </div>
  );
}

export default AboutPage;
