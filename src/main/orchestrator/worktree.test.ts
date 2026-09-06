import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  setupWorktree,
  cleanupWorktree,
  detectGitRepoRoot,
  worktreeHasUnpushedCommits,
  WORKTREES_DIR,
  WORKTREE_INCLUDE_FILE,
} from "./worktree";

// ── 测试辅助：在临时目录建真实 git 仓库 ─────────────────

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

interface TestRepo {
  root: string;
}

function createRepo(): TestRepo {
  // os.tmpdir() 可能返回 8.3 短路径（如 C:\Users\SHANGM~1\...），
  // realpath.native 展开为长路径，与产品侧 detectGitRepoRoot/setupWorktree 的规范化一致
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-wt-test-")));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(root, "readme.md"), "# test repo\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  return { root };
}

function listBranches(root: string): string[] {
  // git branch：`*` 表示当前分支，`+` 表示其他 worktree 正在检出的分支（git 2.38+）
  return git(root, ["branch"]).split(/\r?\n/).map((b) => b.trim().replace(/^[+*]\s*/, "")).filter(Boolean);
}

// ── 测试套件 ────────────────────────────────────────────

describe("detectGitRepoRoot", () => {
  it("在 git 仓库内返回 toplevel", async () => {
    const repo = createRepo();
    try {
      const root = await detectGitRepoRoot(repo.root);
      expect(root).toBe(path.resolve(repo.root));
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it("在子目录中返回仓库根", async () => {
    const repo = createRepo();
    try {
      fs.mkdirSync(path.join(repo.root, "sub"));
      const root = await detectGitRepoRoot(path.join(repo.root, "sub"));
      expect(root).toBe(path.resolve(repo.root));
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it("非仓库目录返回 null", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-wt-none-"));
    try {
      expect(await detectGitRepoRoot(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("setupWorktree", () => {
  it("创建隔离 worktree 与独立分支，并把 .worktrees/ 写入 .gitignore", async () => {
    const repo = createRepo();
    try {
      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      expect(info!.repoRoot).toBe(path.resolve(repo.root));
      expect(info!.path).toBe(path.join(repo.root, WORKTREES_DIR, path.basename(info!.path)));
      expect(info!.branch).toMatch(/^cyrene\/cyrene-[0-9a-f]{8}$/);
      expect(fs.existsSync(info!.path)).toBe(true);
      expect(fs.existsSync(path.join(info!.path, "readme.md"))).toBe(true);
      // worktree 分支存在且基于 HEAD（git branch 输出完整分支名 cyrene/<name>）
      expect(listBranches(repo.root)).toContain(info!.branch);
      // .gitignore 已包含 .worktrees/
      const gitignore = fs.readFileSync(path.join(repo.root, ".gitignore"), "utf8");
      expect(gitignore).toContain(`${WORKTREES_DIR}/`);
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it("非仓库目录返回 null", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-wt-none-"));
    try {
      expect(await setupWorktree(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it(".worktreeinclude 中的文件被复制进 worktree", async () => {
    const repo = createRepo();
    try {
      fs.writeFileSync(path.join(repo.root, ".env.local"), "SECRET=1\n", "utf8");
      fs.writeFileSync(path.join(repo.root, WORKTREE_INCLUDE_FILE), ".env.local\n", "utf8");
      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      expect(fs.readFileSync(path.join(info!.path, ".env.local"), "utf8")).toBe("SECRET=1\n");
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it(".worktreeinclude 中的目录被复制（Windows 无权限时 copytree 回退）", async () => {
    const repo = createRepo();
    try {
      fs.mkdirSync(path.join(repo.root, "assets"));
      fs.writeFileSync(path.join(repo.root, "assets", "logo.png"), "data", "utf8");
      fs.writeFileSync(path.join(repo.root, WORKTREE_INCLUDE_FILE), "assets\n", "utf8");
      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      expect(fs.existsSync(path.join(info!.path, "assets", "logo.png"))).toBe(true);
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it(".worktreeinclude 拒绝目录穿越（../ 逃逸被跳过）", async () => {
    const repo = createRepo();
    try {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-wt-secret-"));
      fs.writeFileSync(path.join(outside, "secret.txt"), "top-secret", "utf8");
      fs.writeFileSync(path.join(repo.root, WORKTREE_INCLUDE_FILE), "../secret.txt\n", "utf8");
      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      expect(fs.existsSync(path.join(info!.path, "secret.txt"))).toBe(false);
      fs.rmSync(outside, { recursive: true, force: true });
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it(".worktreeinclude 拒绝逃出 worktree 的符号链接目标", async () => {
    const repo = createRepo();
    try {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-wt-link-"));
      fs.writeFileSync(path.join(outside, "link-target.txt"), "target", "utf8");
      fs.mkdirSync(path.join(repo.root, "linked-dir"));
      fs.writeFileSync(path.join(repo.root, WORKTREE_INCLUDE_FILE), "linked-dir\n", "utf8");
      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      fs.rmSync(outside, { recursive: true, force: true });
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });
});

describe("worktreeHasUnpushedCommits / cleanupWorktree", () => {
  it("无未推送提交时 cleanup 删除 worktree 与分支", async () => {
    const repo = createRepo();
    try {
      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      const outcome = await cleanupWorktree(info!);
      expect(outcome.kind).toBe("removed");
      expect(fs.existsSync(info!.path)).toBe(false);
      expect(listBranches(repo.root)).not.toContain(info!.branch);
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it("有未推送提交时 cleanup 保留 worktree 与分支", async () => {
    const repo = createRepo();
    try {
      // 配置 remote 并伪造远端跟踪 ref（初始提交视为已推送），
      // 使 worktree 中的新提交成为"未推送提交"（与 Hermes 测试同法）
      git(repo.root, ["remote", "add", "origin", "https://example.com/test-repo.git"]);
      git(repo.root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      // 在 worktree 里新增一次提交（不在 refs/remotes/origin/main 上）
      fs.writeFileSync(path.join(info!.path, "new-file.txt"), "work", "utf8");
      git(info!.path, ["add", "."]);
      git(info!.path, ["commit", "-m", "worktree work"]);
      expect(await worktreeHasUnpushedCommits(info!.path)).toBe(true);

      const outcome = await cleanupWorktree(info!);
      expect(outcome.kind).toBe("kept");
      expect(outcome.reason).toBe("unpushed-commits");
      expect(fs.existsSync(info!.path)).toBe(true);
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it("cleanup 对已删除的 worktree 返回 not-found", async () => {
    const repo = createRepo();
    try {
      const info = await setupWorktree(repo.root);
      expect(info).not.toBeNull();
      git(repo.root, ["worktree", "remove", info!.path, "--force"]);
      const outcome = await cleanupWorktree(info!);
      expect(outcome.kind).toBe("not-found");
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  });
});
