/**
 * 凭据导出/导入（换机迁移）
 *
 * safeStorage 加密值（enc:v1:）绑定本机（Windows DPAPI / macOS Keychain），
 * 直接拷贝 JSON 到新机器无法解密。因此导出时收集全部凭据明文，
 * 用用户提供的口令加密整个包（scrypt 派生密钥 + AES-256-GCM），
 * 导入时用同一口令解密，再经各子系统正常保存路径写入（由本地 safeStorage 重新加密）。
 *
 * 包结构（EncryptedBundle.data 是 CredentialExportBundle 的密文）：
 * {
 *   "format": "cyrene-credentials",
 *   "version": 1,
 *   "exportedAt": <ms>,
 *   "cipher": "aes-256-gcm",
 *   "kdf": { "name": "scrypt", "salt": <base64>, "N": 32768, "r": 8, "p": 1 },
 *   "iv": <base64>,
 *   "authTag": <base64>,
 *   "data": <base64 密文>
 * }
 */

import * as crypto from "node:crypto";

export const CREDENTIAL_BUNDLE_FORMAT = "cyrene-credentials";
export const CREDENTIAL_BUNDLE_VERSION = 1;

/** 一条凭据记录：key 是唯一标识（含作用域前缀），label 是给人看的标签。 */
export interface CredentialEntry {
  key: string;
  label: string;
  /** 明文值（仅在导出包内存中出现，落盘前被 AES 加密） */
  value: string;
}

export interface CredentialExportBundle {
  format: typeof CREDENTIAL_BUNDLE_FORMAT;
  version: typeof CREDENTIAL_BUNDLE_VERSION;
  exportedAt: number;
  credentials: CredentialEntry[];
}

export interface EncryptedCredentialBundle {
  format: typeof CREDENTIAL_BUNDLE_FORMAT;
  version: typeof CREDENTIAL_BUNDLE_VERSION;
  exportedAt: number;
  cipher: "aes-256-gcm";
  kdf: { name: "scrypt"; salt: string; N: number; r: number; p: number };
  iv: string;
  authTag: string;
  data: string;
}

// scrypt 参数：N=2^15（约 32MB 内存，maxmem 提至 64MB 覆盖 OpenSSL 默认上限），
// 兼顾安全与导出/导入速度。
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const KEY_LENGTH = 32;

/** 导出：收集凭据并生成口令加密包。返回 null 表示没有可导出的凭据。 */
export function buildExportBundle(credentials: CredentialEntry[]): CredentialExportBundle | null {
  const filtered = credentials.filter((c) => typeof c.value === "string" && c.value.length > 0);
  if (filtered.length === 0) return null;
  return {
    format: CREDENTIAL_BUNDLE_FORMAT,
    version: CREDENTIAL_BUNDLE_VERSION,
    exportedAt: Date.now(),
    credentials: filtered,
  };
}

/** 加密凭据包。口令为空时返回 null（拒绝无口令导出）。 */
export function encryptBundle(bundle: CredentialExportBundle, passphrase: string): EncryptedCredentialBundle | null {
  if (!passphrase) return null;
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), "utf-8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    format: CREDENTIAL_BUNDLE_FORMAT,
    version: CREDENTIAL_BUNDLE_VERSION,
    exportedAt: bundle.exportedAt,
    cipher: "aes-256-gcm",
    kdf: { name: "scrypt", salt: salt.toString("base64"), N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

/**
 * 解密凭据包。
 * - 口令错误 / 包损坏（GCM 校验失败）→ 返回 { ok: false, error: "口令错误或文件已损坏" }
 * - 格式不合法 → 返回 { ok: false, error: 具体原因 }
 */
export function decryptBundle(
  raw: unknown,
  passphrase: string,
): { ok: true; bundle: CredentialExportBundle } | { ok: false; error: string } {
  if (!passphrase) return { ok: false, error: "请输入口令" };
  const pkg = raw as Partial<EncryptedCredentialBundle>;
  if (!pkg || pkg.format !== CREDENTIAL_BUNDLE_FORMAT || pkg.cipher !== "aes-256-gcm") {
    return { ok: false, error: "不是有效的凭据导出文件" };
  }
  if (typeof pkg.exportedAt !== "number" || typeof pkg.iv !== "string" || typeof pkg.authTag !== "string" || typeof pkg.data !== "string") {
    return { ok: false, error: "凭据文件内容不完整" };
  }
  if (!pkg.kdf || pkg.kdf.name !== "scrypt" || !pkg.kdf.salt) {
    return { ok: false, error: "不支持的加密参数" };
  }
  try {
    const salt = Buffer.from(pkg.kdf.salt, "base64");
    const key = crypto.scryptSync(passphrase, salt, KEY_LENGTH, { N: pkg.kdf.N || SCRYPT_N, r: pkg.kdf.r || SCRYPT_R, p: pkg.kdf.p || SCRYPT_P, maxmem: SCRYPT_MAXMEM });
    const iv = Buffer.from(pkg.iv, "base64");
    const authTag = Buffer.from(pkg.authTag, "base64");
    const cipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([cipher.update(Buffer.from(pkg.data, "base64")), cipher.final()]);
    const bundle = JSON.parse(plaintext.toString("utf-8")) as CredentialExportBundle;
    if (bundle.format !== CREDENTIAL_BUNDLE_FORMAT || !Array.isArray(bundle.credentials)) {
      return { ok: false, error: "凭据包内容格式不合法" };
    }
    return { ok: true, bundle };
  } catch {
    return { ok: false, error: "口令错误或文件已损坏" };
  }
}
