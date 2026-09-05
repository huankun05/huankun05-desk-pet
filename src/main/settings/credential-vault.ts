/**
 * CredentialVault — 通用凭据加密保险箱
 *
 * 基于 Electron safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret）
 * 对 API Key、Token 等敏感凭据进行加密存储。
 *
 * 设计原则（移植自 music/token-vault.ts 的 TokenVault 模式）：
 * - 内存中始终明文（调用方无感知）
 * - 落盘时加密（JSON 文件中不可见明文）
 * - 向后兼容：旧明文自动识别并迁移（首次保存时加密）
 * - safeStorage 不可用时回退明文（dev 环境，打 warning）
 * - 加密值带 `enc:v1:` 前缀，便于识别和未来版本升级
 *
 * 使用方式：
 *   const vault = new CredentialVault();
 *   const encrypted = vault.encrypt("sk-xxx");     // "enc:v1:..."
 *   const plaintext = vault.decrypt(encrypted);     // "sk-xxx"
 *   vault.decrypt("sk-xxx");                          // "sk-xxx"（明文透传）
 */

import { safeStorage } from "electron";

const ENCRYPTED_PREFIX = "enc:v1:";

export class CredentialVault {
  private readonly storage: Pick<
    typeof safeStorage,
    "isEncryptionAvailable" | "encryptString" | "decryptString"
  >;

  constructor(
    storage: Pick<typeof safeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString"> = safeStorage,
  ) {
    this.storage = storage;
  }

  /** safeStorage 是否可用（不可用时 encrypt 回退明文）。 */
  isAvailable(): boolean {
    try {
      return this.storage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * 加密明文凭据。
   * - safeStorage 可用 → 返回 `enc:v1:<base64>`
   * - safeStorage 不可用 → 返回原文（打 warning，仅 dev 环境）
   * - 空字符串 → 直接返回空字符串（不加密空值）
   */
  encrypt(plaintext: string): string {
    if (!plaintext) return "";
    // 已经是加密值，不重复加密
    if (this.isEncrypted(plaintext)) return plaintext;
    if (!this.isAvailable()) {
      console.warn("[CredentialVault] safeStorage 不可用，凭据将以明文保存（不安全，仅 dev 环境）");
      return plaintext;
    }
    try {
      const encrypted = this.storage.encryptString(plaintext);
      return ENCRYPTED_PREFIX + encrypted.toString("base64");
    } catch (err) {
      console.error("[CredentialVault] 加密失败，回退明文:", err instanceof Error ? err.message : err);
      return plaintext;
    }
  }

  /**
   * 解密凭据。
   * - `enc:v1:` 前缀 → 解密返回明文
   * - 无前缀 → 视为旧明文，直接返回（向后兼容）
   * - 空字符串 → 返回空字符串
   */
  decrypt(value: string): string {
    if (!value) return "";
    if (!this.isEncrypted(value)) return value;
    if (!this.isAvailable()) {
      console.error("[CredentialVault] safeStorage 不可用，无法解密加密凭据");
      return "";
    }
    try {
      const base64 = value.slice(ENCRYPTED_PREFIX.length);
      const buffer = Buffer.from(base64, "base64");
      return this.storage.decryptString(buffer);
    } catch (err) {
      console.error("[CredentialVault] 解密失败:", err instanceof Error ? err.message : err);
      return "";
    }
  }

  /** 判断值是否为已加密的凭据。 */
  isEncrypted(value: string): boolean {
    return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
  }
}

/** 全局单例（main 进程共用一个 vault 实例）。 */
let globalVault: CredentialVault | null = null;

export function getCredentialVault(): CredentialVault {
  if (!globalVault) {
    globalVault = new CredentialVault();
  }
  return globalVault;
}
