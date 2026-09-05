import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceContext, MAX_WORKSPACE_CONTEXT_CHARS } from "./workspace-context";

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-workspace-ctx-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("loadWorkspaceContext", () => {
  it("returns undefined when no workspace root is bound", () => {
    expect(loadWorkspaceContext(undefined)).toBeUndefined();
    expect(loadWorkspaceContext("")).toBeUndefined();
  });

  it("returns undefined when AGENTS.md does not exist", () => {
    const root = makeRoot();
    expect(loadWorkspaceContext(root)).toBeUndefined();
  });

  it("returns undefined for an empty AGENTS.md", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "AGENTS.md"), "  \n\t\n", "utf8");
    expect(loadWorkspaceContext(root)).toBeUndefined();
  });

  it("loads the project conventions as a marked context block", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "AGENTS.md"), "构建：npm run build\n测试：npm test", "utf8");

    const block = loadWorkspaceContext(root);
    expect(block).toContain("[WORKSPACE_CONTEXT]");
    expect(block).toContain("npm test");
    expect(block?.split("\n")[0]).toBe("[WORKSPACE_CONTEXT]");
  });

  it("truncates an oversized AGENTS.md with a marker", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "AGENTS.md"), "x".repeat(MAX_WORKSPACE_CONTEXT_CHARS + 500), "utf8");

    const block = loadWorkspaceContext(root)!;
    expect(block.length).toBeLessThan(MAX_WORKSPACE_CONTEXT_CHARS + 200);
    expect(block).toContain("已截断");
  });
});
