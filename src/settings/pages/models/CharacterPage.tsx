import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch, Modal, useToast, useConfirm } from '../../components';
import { SettingsJumpButton } from '../../components/SettingsJumpButton';
import { personaManager } from '../../../services/persona/manager';
import { createDefaultProfile } from '../../../services/persona/promptEngine';
import type { CharacterProfile } from '../../../services/persona/types';
import { createStorage } from '../../../services/storage';

const inputClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]';

/** 全局默认提示词存储 */
const globalPromptStorage = createStorage<string>('deskpet_global_system_prompt', '');

export function CharacterPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [globalPrompt, setGlobalPrompt] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    systemPrompt: '',
    enabled: true,
  });

  const loadAll = useCallback(async () => {
    await personaManager.ready;
    setProfiles(personaManager.getProfiles());
    setActiveId(personaManager.getActiveProfile().id);
    const g = globalPromptStorage.get();
    setGlobalPrompt(g ?? '');
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSetActive = (id: string) => {
    personaManager.setActive(id);
    setActiveId(id);
    showToast(t('settings.models.character_activated'), 'success');
  };

  const openAddModal = () => {
    setEditingId(null);
    setForm({ name: '', systemPrompt: '', enabled: true });
    setShowModal(true);
  };

  const openEditModal = (profile: CharacterProfile) => {
    setEditingId(profile.id);
    setForm({
      name: profile.name,
      systemPrompt: profile.systemPrompt,
      enabled: profile.enabled,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      showToast(t('settings.services.validation_required'), 'warning');
      return;
    }
    if (editingId) {
      const existing = profiles.find((p) => p.id === editingId);
      if (existing) {
        personaManager.saveProfile({
          ...existing,
          name: form.name,
          systemPrompt: form.systemPrompt,
          enabled: form.enabled,
        });
      }
    } else {
      const id = `char-${Date.now()}`;
      personaManager.saveProfile({
        ...createDefaultProfile(form.name),
        id,
        systemPrompt: form.systemPrompt || createDefaultProfile(form.name).systemPrompt,
        enabled: form.enabled,
      });
    }
    loadAll();
    showToast(t('settings.preferences.saved'), 'success');
    closeModal();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(t('settings.services.confirm_delete')))) return;
    personaManager.deleteProfile(id);
    loadAll();
    showToast(t('settings.services.deleted'), 'success');
  };

  const handleSaveGlobalPrompt = () => {
    globalPromptStorage.set(globalPrompt);
    showToast(t('settings.preferences.saved'), 'success');
  };

  const patchForm = (p: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...p }));

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 全局默认提示词 */}
      <Section
        title={t('settings.models.global_prompt_title')}
        description={t('settings.models.global_prompt_desc')}
      >
        <div className="p-4 space-y-3">
          <textarea
            className={`${inputClass} min-h-[100px] resize-y`}
            value={globalPrompt}
            onChange={(e) => setGlobalPrompt(e.target.value)}
            placeholder={t('settings.models.global_prompt_placeholder')}
          />
          <p className="text-xs text-neutral-400">{t('settings.models.global_prompt_hint')}</p>
          <button
            type="button"
            onClick={handleSaveGlobalPrompt}
            className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
          >
            {t('settings.save')}
          </button>
        </div>
      </Section>

      {/* 角色列表 */}
      <Section
        title={t('settings.models.character_list_title')}
        description={t('settings.models.character_list_desc')}
      >
        <div className="p-4">
          <div className="grid gap-3">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                onClick={() => handleSetActive(profile.id)}
                className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  activeId === profile.id
                    ? 'border-[var(--primary-500)] bg-[var(--primary-50)]/50'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                        activeId === profile.id
                          ? 'bg-[var(--primary-500)] text-white'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}
                    >
                      <Icon icon="solar:user-circle-bold-duotone" className="text-xl" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-neutral-800 truncate">
                          {profile.name}
                        </span>
                        {activeId === profile.id && (
                          <span className="shrink-0 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary-600)]">
                            {t('settings.services.active_label')}
                          </span>
                        )}
                        {!profile.enabled && (
                          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
                            {t('common.disabled')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1 line-clamp-2">
                        {profile.systemPrompt.slice(0, 100)}
                        {profile.systemPrompt.length > 100 ? '...' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(profile);
                      }}
                      className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                      title={t('common.edit')}
                    >
                      <Icon icon="solar:pen-bold" className="text-base" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(profile.id);
                      }}
                      className="p-2 rounded-lg text-neutral-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                      title={t('common.delete')}
                    >
                      <Icon icon="solar:trash-bin-trash-bold" className="text-base" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 py-3 text-sm font-medium text-neutral-500 hover:border-[var(--primary-300)] hover:text-[var(--primary-500)] hover:bg-[var(--primary-50)]/50 transition-colors"
          >
            <Icon icon="solar:add-circle-bold" className="text-base" />
            {t('settings.models.add_character')}
          </button>
        </div>
      </Section>

      {/* 相关设置：角色相关的其它配置在独立页面 */}
      <Section title={t('settings.related_settings')}>
        <div className="space-y-2 p-4">
          <SettingsJumpButton
            to="/settings/models/behavior"
            label={t('settings.models.behavior')}
            icon="solar:user-heart-bold-duotone"
            hint={t('settings.models.related_behavior_hint')}
          />
          <SettingsJumpButton
            to="/settings/models/emotion"
            label={t('settings.models.emotion')}
            icon="solar:emoji-funny-circle-bold-duotone"
            hint={t('settings.models.related_emotion_hint')}
          />
        </div>
      </Section>

      {/* 编辑/新增 Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? t('settings.models.edit_character') : t('settings.models.add_character')}
        maxWidth="max-w-lg"
        footer={
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
          >
            {t('settings.save')}
          </button>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.models.character_name')}
            </label>
            <input
              type="text"
              className={inputClass}
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
              placeholder={t('settings.models.character_name_placeholder')}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.models.character_system_prompt')}
            </label>
            <textarea
              className={`${inputClass} min-h-[120px] resize-y`}
              value={form.systemPrompt}
              onChange={(e) => patchForm({ systemPrompt: e.target.value })}
              placeholder={t('settings.models.character_system_prompt_placeholder')}
            />
            <p className="mt-1 text-xs text-neutral-400">
              {t('settings.models.character_system_prompt_hint')}
            </p>
          </div>

          <div className="border-t border-neutral-100 pt-3">
            <SettingRow
              title={t('common.enabled')}
              description={t('settings.models.character_enable_desc')}
            >
              <Switch
                checked={form.enabled}
                onChange={() => patchForm({ enabled: !form.enabled })}
              />
            </SettingRow>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default CharacterPage;
