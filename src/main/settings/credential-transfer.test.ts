import { describe, it, expect } from "vitest";
import {
  buildExportBundle,
  encryptBundle,
  decryptBundle,
  CREDENTIAL_BUNDLE_FORMAT,
} from "./credential-transfer";

const SAMPLE_CREDS = [
  { key: "model:provider:DeepSeek（深度求索）", label: "模型「DeepSeek（深度求索）」API Key", value: "sk-test-123" },
  { key: "mcp:github:GH_TOKEN", label: "MCP「GitHub」环境变量 GH_TOKEN", value: "ghp_abc" },
  { key: "model:provider:Empty", label: "空值", value: "" },
];

describe("credential-transfer", () => {
  describe("buildExportBundle", () => {
    it("过滤空值并生成合法 bundle", () => {
      const bundle = buildExportBundle(SAMPLE_CREDS);
      expect(bundle).not.toBeNull();
      expect(bundle!.format).toBe(CREDENTIAL_BUNDLE_FORMAT);
      expect(bundle!.credentials).toHaveLength(2);
    });

    it("全部为空值时返回 null", () => {
      expect(buildExportBundle([{ key: "a", label: "a", value: "" }])).toBeNull();
      expect(buildExportBundle([])).toBeNull();
    });
  });

  describe("encryptBundle / decryptBundle", () => {
    it("口令加解密往返一致", () => {
      const bundle = buildExportBundle(SAMPLE_CREDS)!;
      const encrypted = encryptBundle(bundle, "my-passphrase");
      expect(encrypted).not.toBeNull();
      // 密文不包含任何明文凭据
      expect(JSON.stringify(encrypted)).not.toContain("sk-test-123");
      expect(JSON.stringify(encrypted)).not.toContain("ghp_abc");
      const result = decryptBundle(encrypted, "my-passphrase");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.bundle.credentials).toEqual(bundle.credentials);
      }
    });

    it("空口令返回 null", () => {
      const bundle = buildExportBundle(SAMPLE_CREDS)!;
      expect(encryptBundle(bundle, "")).toBeNull();
    });

    it("错误口令解密失败", () => {
      const bundle = buildExportBundle(SAMPLE_CREDS)!;
      const encrypted = encryptBundle(bundle, "correct-passphrase")!;
      const result = decryptBundle(encrypted, "wrong-passphrase");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("口令错误");
    });

    it("非凭据文件返回格式错误", () => {
      const result = decryptBundle({ foo: "bar" }, "pass");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("不是有效的凭据导出文件");
    });

    it("空口令解密失败", () => {
      const result = decryptBundle({ format: CREDENTIAL_BUNDLE_FORMAT, cipher: "aes-256-gcm" }, "");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("请输入口令");
    });

    it("篡改密文（GCM 校验）解密失败", () => {
      const bundle = buildExportBundle(SAMPLE_CREDS)!;
      const encrypted = encryptBundle(bundle, "pass")!;
      const tampered = {
        ...encrypted,
        data: Buffer.from("tampered").toString("base64"),
      };
      const result = decryptBundle(tampered, "pass");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("口令错误或文件已损坏");
    });

    it("每次加密随机盐与 IV（密文不同）", () => {
      const bundle = buildExportBundle(SAMPLE_CREDS)!;
      const a = encryptBundle(bundle, "pass")!;
      const b = encryptBundle(bundle, "pass")!;
      expect(a.data).not.toBe(b.data);
      expect(a.kdf.salt).not.toBe(b.kdf.salt);
      expect(a.iv).not.toBe(b.iv);
    });
  });
});
