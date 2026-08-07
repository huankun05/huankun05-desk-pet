export interface BackupManifest {
  version: string;
  timestamp: string;
  checksum: string;
  entries: BackupEntry[];
  totalSize: number;
}

export interface BackupEntry {
  id: string;
  name: string;
  /** 逻辑分类（用于 UI 展示与还原映射），此处放宽为 string 以容纳各类数据 */
  type: string;
  size: number;
  path: string;
}

export interface BackupOptions {
  includeSettings?: boolean;
  includeChat?: boolean;
  includeMemory?: boolean;
  includeProviders?: boolean;
  includePlugins?: boolean;
  includeCron?: boolean;
}

export interface RestoreOptions {
  overwrite?: boolean;
  skipErrors?: boolean;
}

export interface BackupProgress {
  current: number;
  total: number;
  status: string;
}

/** 自动备份频率 */
export type BackupFrequency = 'startup' | 'daily' | 'weekly';

/** 备份配置（持久化于 createStorage('backup_config')） */
export interface BackupConfig {
  /** 是否开启自动备份 */
  enabled: boolean;
  /** 触发频率：启动即备 / 每日 / 每周 */
  frequency: BackupFrequency;
  /** 自定义备份目录（绝对路径）；为空则使用默认 <项目数据目录>/backups */
  dir: string;
  /** 滚动保留份数（超出删除最旧） */
  keepCount: number;
  /** 上次成功备份的 epoch 毫秒，用于频率判定 */
  lastBackup: number;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  enabled: false,
  frequency: 'weekly',
  dir: '',
  keepCount: 5,
  lastBackup: 0,
};

/** 单个备份文件（目录枚举得到） */
export interface BackupFile {
  name: string;
  path: string;
  size: number;
  /** 从文件名解析出的 epoch 毫秒 */
  timestamp: number;
}
