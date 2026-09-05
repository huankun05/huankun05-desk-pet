import { describe, it, expect, vi, beforeEach } from "vitest";
import { CredentialVault } from "./credential-vault";

// Mock electron safeStorage
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`mock-enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8").replace(/^mock-enc:/, "")),
  },
}));

const makeMockStorage = (available = true) => ({
  isEncryptionAvailable: vi.fn(() => available),
  encryptString: vi.fn((s: string) => Buffer.from(`mock-enc:${s}`)),
  decryptString: vi.fn((b: Buffer) => b.toString("utf8").replace(/^mock-enc:/, "")),
});

describe("CredentialVault", () => {
  describe("isAvailable", () => {
    it("returns true when safeStorage is available", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      expect(vault.isAvailable()).toBe(true);
    });

    it("returns false when safeStorage is unavailable", () => {
      const vault = new CredentialVault(makeMockStorage(false));
      expect(vault.isAvailable()).toBe(false);
    });

    it("returns false when safeStorage throws", () => {
      const vault = new CredentialVault({
        isEncryptionAvailable: vi.fn(() => { throw new Error("boom"); }),
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      });
      expect(vault.isAvailable()).toBe(false);
    });
  });

  describe("encrypt", () => {
    it("encrypts plaintext with enc:v1: prefix", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      const result = vault.encrypt("sk-test-key-123");
      expect(result).toMatch(/^enc:v1:/);
      // base64 of "mock-enc:sk-test-key-123"
      const expectedB64 = Buffer.from("mock-enc:sk-test-key-123").toString("base64");
      expect(result).toBe(`enc:v1:${expectedB64}`);
    });

    it("returns empty string for empty input", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      expect(vault.encrypt("")).toBe("");
    });

    it("does not double-encrypt already encrypted values", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      const once = vault.encrypt("sk-key");
      const twice = vault.encrypt(once);
      expect(twice).toBe(once);
    });

    it("falls back to plaintext when safeStorage unavailable", () => {
      const vault = new CredentialVault(makeMockStorage(false));
      const result = vault.encrypt("sk-key");
      expect(result).toBe("sk-key");
    });

    it("falls back to plaintext when encrypt throws", () => {
      const vault = new CredentialVault({
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn(() => { throw new Error("encrypt failed"); }),
        decryptString: vi.fn(),
      });
      const result = vault.encrypt("sk-key");
      expect(result).toBe("sk-key");
    });
  });

  describe("decrypt", () => {
    it("decrypts enc:v1: prefixed values", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      const encrypted = vault.encrypt("sk-secret-key");
      const decrypted = vault.decrypt(encrypted);
      expect(decrypted).toBe("sk-secret-key");
    });

    it("passes through plaintext (backward compatibility)", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      expect(vault.decrypt("sk-old-plaintext-key")).toBe("sk-old-plaintext-key");
    });

    it("returns empty string for empty input", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      expect(vault.decrypt("")).toBe("");
    });

    it("returns empty string when safeStorage unavailable for encrypted value", () => {
      const vault = new CredentialVault(makeMockStorage(false));
      // First encrypt with available storage
      const availableVault = new CredentialVault(makeMockStorage(true));
      const encrypted = availableVault.encrypt("sk-key");
      // Then try to decrypt with unavailable storage
      expect(vault.decrypt(encrypted)).toBe("");
    });

    it("returns empty string when decrypt throws", () => {
      const vault = new CredentialVault({
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((s: string) => Buffer.from(s)),
        decryptString: vi.fn(() => { throw new Error("decrypt failed"); }),
      });
      const encrypted = vault.encrypt("sk-key");
      expect(vault.decrypt(encrypted)).toBe("");
    });
  });

  describe("isEncrypted", () => {
    it("detects encrypted values", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      const encrypted = vault.encrypt("sk-key");
      expect(vault.isEncrypted(encrypted)).toBe(true);
    });

    it("returns false for plaintext", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      expect(vault.isEncrypted("sk-plaintext")).toBe(false);
    });

    it("returns false for empty string", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      expect(vault.isEncrypted("")).toBe(false);
    });
  });

  describe("round-trip", () => {
    it("encrypt then decrypt returns original", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      const original = "sk-complex-key-with-special-chars-!@#$%^&*()";
      const encrypted = vault.encrypt(original);
      const decrypted = vault.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it("handles long API keys", () => {
      const vault = new CredentialVault(makeMockStorage(true));
      const original = "sk-" + "a".repeat(200);
      const encrypted = vault.encrypt(original);
      const decrypted = vault.decrypt(encrypted);
      expect(decrypted).toBe(original);
      expect(encrypted.length).toBeGreaterThan(original.length);
    });
  });
});
