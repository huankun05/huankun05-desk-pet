import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export type ShellKind = "cmd" | "bash";

export interface ResolvedShellExecutable {
  kind: ShellKind;
  executable: string;
}

export function buildDirectShellInvocation(
  shell: ResolvedShellExecutable,
  command: string,
): { command: string; args: string[]; windowsVerbatimArguments: boolean } {
  if (shell.kind === "bash") {
    return {
      command: shell.executable,
      args: ["--noprofile", "--norc", "-lc", command],
      windowsVerbatimArguments: false,
    };
  }
  return {
    command: shell.executable,
    args: ["/d", "/s", "/c", command],
    windowsVerbatimArguments: true,
  };
}

export async function resolveShellExecutable(kind: ShellKind): Promise<ResolvedShellExecutable | null> {
  if (kind === "cmd") {
    return { kind, executable: process.env.ComSpec || "cmd.exe" };
  }

  for (const candidate of collectBashCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    if (await probeBash(candidate)) return { kind, executable: candidate };
  }
  return null;
}

function collectBashCandidates(): string[] {
  const candidates: string[] = [];
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (directory) candidates.push(path.join(directory, "bash.exe"));
  }

  // 通过 PATH 中的 git 反推其安装根，覆盖自定义/便携安装位置（仅把 cmd 目录加入 PATH 的情况）
  candidates.push(...collectGitDerivedBashCandidates());

  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  if (programFiles) candidates.push(path.join(programFiles, "Git", "bin", "bash.exe"));
  if (programFilesX86) candidates.push(path.join(programFilesX86, "Git", "bin", "bash.exe"));
  if (localAppData) candidates.push(path.join(localAppData, "Programs", "Git", "bin", "bash.exe"));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = path.normalize(candidate).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 从 PATH 中的 git 可执行文件（git.exe/git.cmd/git.bat）反推安装根，返回其 bin/usr 下的 bash.exe 候选。 */
function collectGitDerivedBashCandidates(): string[] {
  const candidates: string[] = [];
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (!directory) continue;
    for (const name of ["git.exe", "git.cmd", "git.bat"]) {
      const gitPath = path.join(directory, name);
      if (!fs.existsSync(gitPath)) continue;
      const gitRoot = path.dirname(path.dirname(gitPath));
      candidates.push(path.join(gitRoot, "bin", "bash.exe"));
      candidates.push(path.join(gitRoot, "usr", "bin", "bash.exe"));
    }
  }
  return candidates;
}

function probeBash(executable: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(executable, ["--noprofile", "--norc", "-lc", "printf cyrene-bash-probe"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && stdout === "cyrene-bash-probe"));
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      finish(false);
    }, 3_000);
  });
}
