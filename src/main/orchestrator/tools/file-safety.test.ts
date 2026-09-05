// file-safety.test.ts — 文件安全黑名单单元测试
//
// 测试覆盖：
// 1. 精确敏感路径拒绝写入
// 2. 敏感目录前缀拒绝写入
// 3. 普通路径允许写入
// 4. 项目级 .env 文件拒绝读取
// 5. SSH 私钥文件拒绝读取
// 6. 普通文件允许读取
// 7. 路径规范化（~、相对路径、混合分隔符）

import { describe, it, expect } from "vitest";
import * as os from "os";
import * as path from "path";
import {
  isWriteDenied,
  getWriteDeniedError,
  getReadBlockError,
  buildWriteDeniedPaths,
  buildWriteDeniedPrefixes,
  isPathInWorkspace,
} from "./file-safety";

const home = os.homedir();

describe("file-safety: 精确敏感路径拒绝写入", () => {
  it("拒绝写入 SSH 私钥 id_rsa", () => {
    const p = path.join(home, ".ssh", "id_rsa");
    expect(isWriteDenied(p)).toBe(true);
    expect(getWriteDeniedError(p)).not.toBeNull();
  });

  it("拒绝写入 SSH 私钥 id_ed25519", () => {
    const p = path.join(home, ".ssh", "id_ed25519");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 SSH config", () => {
    const p = path.join(home, ".ssh", "config");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .netrc", () => {
    const p = path.join(home, ".netrc");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .pgpass", () => {
    const p = path.join(home, ".pgpass");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .npmrc", () => {
    const p = path.join(home, ".npmrc");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .git-credentials", () => {
    const p = path.join(home, ".git-credentials");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 AWS credentials", () => {
    const p = path.join(home, ".aws", "credentials");
    expect(isWriteDenied(p)).toBe(true);
  });
});

describe("file-safety: 敏感目录前缀拒绝写入", () => {
  it("拒绝写入 .ssh 目录下任意文件", () => {
    const p = path.join(home, ".ssh", "my_custom_key");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .aws 目录下任意文件", () => {
    const p = path.join(home, ".aws", "custom_credentials");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .gnupg 目录下任意文件", () => {
    const p = path.join(home, ".gnupg", "custom_keyring");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .kube 目录下任意文件", () => {
    const p = path.join(home, ".kube", "custom_config");
    expect(isWriteDenied(p)).toBe(true);
  });

  it("拒绝写入 .docker 目录下任意文件", () => {
    const p = path.join(home, ".docker", "custom_config.json");
    expect(isWriteDenied(p)).toBe(true);
  });
});

describe("file-safety: 普通路径允许写入", () => {
  it("允许写入项目源码文件", () => {
    const p = path.join("C:", "Work", "project", "src", "index.ts");
    expect(isWriteDenied(p)).toBe(false);
    expect(getWriteDeniedError(p)).toBeNull();
  });

  it("允许写入文档文件", () => {
    const p = path.join("C:", "Users", "me", "Documents", "notes.md");
    expect(isWriteDenied(p)).toBe(false);
  });

  it("允许写入项目配置文件（非敏感）", () => {
    const p = path.join("C:", "Work", "project", "package.json");
    expect(isWriteDenied(p)).toBe(false);
  });

  it("允许写入临时文件", () => {
    const p = path.join("C:", "Temp", "output.txt");
    expect(isWriteDenied(p)).toBe(false);
  });
});

describe("file-safety: 读取拒绝", () => {
  it("拒绝读取项目级 .env 文件", () => {
    const p = path.join("C:", "Work", "project", ".env");
    const err = getReadBlockError(p);
    expect(err).not.toBeNull();
    expect(err).toContain("环境文件");
  });

  it("拒绝读取 .env.local 文件", () => {
    const p = path.join("C:", "Work", "project", ".env.local");
    expect(getReadBlockError(p)).not.toBeNull();
  });

  it("拒绝读取 .env.production 文件", () => {
    const p = path.join("C:", "Work", "project", ".env.production");
    expect(getReadBlockError(p)).not.toBeNull();
  });

  it("拒绝读取 .envrc 文件", () => {
    const p = path.join("C:", "Work", "project", ".envrc");
    expect(getReadBlockError(p)).not.toBeNull();
  });

  it("拒绝读取 SSH 私钥 id_rsa", () => {
    const p = path.join(home, ".ssh", "id_rsa");
    const err = getReadBlockError(p);
    expect(err).not.toBeNull();
    expect(err).toContain("SSH");
  });

  it("拒绝读取 SSH 私钥 id_ed25519", () => {
    const p = path.join(home, ".ssh", "id_ed25519");
    expect(getReadBlockError(p)).not.toBeNull();
  });

  it("拒绝读取 authorized_keys", () => {
    const p = path.join(home, ".ssh", "authorized_keys");
    expect(getReadBlockError(p)).not.toBeNull();
  });

  it("允许读取普通源码文件", () => {
    const p = path.join("C:", "Work", "project", "src", "index.ts");
    expect(getReadBlockError(p)).toBeNull();
  });

  it("允许读取普通文档文件", () => {
    const p = path.join("C:", "Users", "me", "Documents", "readme.md");
    expect(getReadBlockError(p)).toBeNull();
  });

  it("允许读取 package.json", () => {
    const p = path.join("C:", "Work", "project", "package.json");
    expect(getReadBlockError(p)).toBeNull();
  });
});

describe("file-safety: 路径规范化", () => {
  it("支持 ~ 展开", () => {
    const p = "~/.ssh/id_rsa";
    expect(isWriteDenied(p)).toBe(true);
  });

  it("支持混合分隔符（/ 和 \\）", () => {
    const p = home.replace(/\\/g, "/") + "/.ssh/id_rsa";
    expect(isWriteDenied(p)).toBe(true);
  });

  it("支持相对路径解析", () => {
    // 相对路径会基于 cwd 解析，这里只测试不报错
    const p = "./src/index.ts";
    expect(() => isWriteDenied(p)).not.toThrow();
  });
});

describe("file-safety: isPathInWorkspace", () => {
  it("识别工作区内的文件", () => {
    const workspace = "C:\\Work\\project";
    const file = "C:\\Work\\project\\src\\index.ts";
    expect(isPathInWorkspace(file, workspace)).toBe(true);
  });

  it("识别工作区根目录本身", () => {
    const workspace = "C:\\Work\\project";
    expect(isPathInWorkspace(workspace, workspace)).toBe(true);
  });

  it("识别工作区外的文件", () => {
    const workspace = "C:\\Work\\project";
    const file = "C:\\Other\\file.txt";
    expect(isPathInWorkspace(file, workspace)).toBe(false);
  });

  it("支持正斜杠路径", () => {
    const workspace = "C:/Work/project";
    const file = "C:/Work/project/src/index.ts";
    expect(isPathInWorkspace(file, workspace)).toBe(true);
  });
});

describe("file-safety: 构建函数返回非空列表", () => {
  it("buildWriteDeniedPaths 返回非空列表", () => {
    const paths = buildWriteDeniedPaths();
    expect(paths.length).toBeGreaterThan(0);
  });

  it("buildWriteDeniedPrefixes 返回非空列表", () => {
    const prefixes = buildWriteDeniedPrefixes();
    expect(prefixes.length).toBeGreaterThan(0);
  });

  it("所有前缀以路径分隔符结尾", () => {
    const prefixes = buildWriteDeniedPrefixes();
    for (const p of prefixes) {
      expect(p.endsWith(path.sep)).toBe(true);
    }
  });
});
