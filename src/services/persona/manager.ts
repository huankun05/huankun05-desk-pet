/**
 * PersonaManager — 人设管理器
 *
 * 持久化存储 CharacterProfile，管理活跃人设切换。
 * 借鉴 AstrBot PersonaManager 的设计。
 */

import type { CharacterProfile, PersonaStore, PersonaFolder } from './types';
import { PRESET_PROFILES, createDefaultProfile } from './promptEngine';
import { createStorage } from '../storage';
import { createLogger } from '../../utils/logger';

const log = createLogger('Persona');

const DEFAULT_STORE: PersonaStore = {
  activePersonaId: 'default',
  profiles: PRESET_PROFILES,
  folders: [{ id: 'root', name: '默认', sortOrder: 0 }],
};

const personaStorage = createStorage<PersonaStore>('persona_store', DEFAULT_STORE);

class PersonaManager {
  private store: PersonaStore = { ...DEFAULT_STORE };
  private readyPromise: Promise<void>;
  /** 活跃人设变化监听器（用于记忆按角色隔离的响应式刷新） */
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.readyPromise = personaStorage.init().then(() => {
      const saved = personaStorage.get();
      if (saved && saved.profiles && saved.profiles.length > 0) {
        this.store = saved;
      } else {
        this.store = { ...DEFAULT_STORE };
        personaStorage.set(this.store);
      }
      log.info('PersonaManager initialized', {
        profiles: this.store.profiles.length,
        active: this.store.activePersonaId,
      });
    });
  }

  get ready(): Promise<void> {
    return this.readyPromise;
  }

  private save(): void {
    personaStorage.set(this.store);
  }

  /** 获取活跃人设 */
  getActiveProfile(): CharacterProfile {
    const found = this.store.profiles.find((p) => p.id === this.store.activePersonaId);
    return found || this.store.profiles[0] || createDefaultProfile();
  }

  /** 获取所有人设 */
  getProfiles(): CharacterProfile[] {
    return [...this.store.profiles].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** 获取已启用的所有人设 */
  getEnabledProfiles(): CharacterProfile[] {
    return this.getProfiles().filter((p) => p.enabled);
  }

  /** 切换活跃人设 */
  setActive(id: string): boolean {
    const exists = this.store.profiles.some((p) => p.id === id);
    if (!exists) return false;
    this.store.activePersonaId = id;
    this.save();
    log.info('Active persona changed', { id });
    this.notify();
    return true;
  }

  /** 创建 / 更新人设 */
  saveProfile(profile: CharacterProfile): void {
    const idx = this.store.profiles.findIndex((p) => p.id === profile.id);
    const now = new Date();
    if (idx >= 0) {
      this.store.profiles[idx] = { ...profile, updatedAt: now };
    } else {
      this.store.profiles.push({ ...profile, createdAt: now, updatedAt: now });
    }
    this.save();
    log.info('Profile saved', { id: profile.id, name: profile.name });
  }

  /** 删除人设 */
  deleteProfile(id: string): boolean {
    const idx = this.store.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.store.profiles.splice(idx, 1);
    // 如果删除的是活跃人设，切到第一个
    if (this.store.activePersonaId === id) {
      this.store.activePersonaId = this.store.profiles[0]?.id || 'default';
    }
    this.save();
    log.info('Profile deleted', { id });
    this.notify();
    return true;
  }

  /**
   * 订阅活跃人设变化。返回取消订阅函数。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  /** 创建文件夹 */
  createFolder(name: string, sortOrder = this.store.folders.length): PersonaFolder {
    const folder: PersonaFolder = {
      id: `folder_${Date.now()}`,
      name,
      sortOrder,
    };
    this.store.folders.push(folder);
    this.save();
    return folder;
  }

  /** 获取所有文件夹 */
  getFolders(): PersonaFolder[] {
    return [...this.store.folders].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** 重新排序人设 */
  reorderProfiles(ids: string[]): void {
    ids.forEach((id, i) => {
      const p = this.store.profiles.find((p) => p.id === id);
      if (p) p.sortOrder = i;
    });
    this.save();
  }

  /** 恢复预设人设（不会覆盖已有的同名 id） */
  restorePresets(): void {
    for (const preset of PRESET_PROFILES) {
      if (!this.store.profiles.find((p) => p.id === preset.id)) {
        this.store.profiles.push({ ...preset, createdAt: new Date(), updatedAt: new Date() });
      }
    }
    this.save();
    log.info('Presets restored');
  }

  /** 获取完整存储（供管理后台读取） */
  getStore(): PersonaStore {
    return { ...this.store };
  }

  /** 从管理后台批量更新 */
  updateStore(update: Partial<PersonaStore>): void {
    Object.assign(this.store, update);
    this.save();
  }
}

export const personaManager = new PersonaManager();
