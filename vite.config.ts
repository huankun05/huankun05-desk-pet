import { defineConfig, type Plugin } from "vite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "path";
import react from "@vitejs/plugin-react";

/**
 * Inject the app version (read from package.json) into any HTML that
 * contains the placeholder `<span data-app-version></span>`.
 *
 * Replaces the placeholder with `昔涟 v<version>`, matching the existing
 * display format. Keeping the prefix in the plugin (rather than the HTML)
 * means the version is the only thing that ever changes.
 */
function appVersionPlugin(): Plugin {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "package.json"), "utf8"),
  ) as { version: string };
  const versionText = `昔涟 v${pkg.version}`;
  return {
    name: "cyrene-app-version",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(
          /<span data-app-version><\/span>/g,
          `<span data-app-version>${versionText}</span>`,
        );
      },
    },
  };
}

/**
 * 把实际监听的开发端口写入 dist/main/.vite-dev-url.json，
 * 供主进程 getDevServerBaseUrl() 读取（5173 被占用顺延端口时避免加载错地址）。
 */
function devUrlProbePlugin(): Plugin {
  return {
    name: "cyrene-vite-dev-url",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") return;
        const file = join(__dirname, "dist", "main", ".vite-dev-url.json");
        try {
          mkdirSync(join(__dirname, "dist", "main"), { recursive: true });
          writeFileSync(file, JSON.stringify({ url: `http://localhost:${address.port}` }));
        } catch {
          // 写入失败只影响动态端口回退，非致命
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), appVersionPlugin(), devUrlProbePlugin()],
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        renderer: resolve(__dirname, "src/renderer/index.html"),
        sidebar: resolve(__dirname, "src/renderer/sidebar/index.html"),
        tasks: resolve(__dirname, "src/renderer/tasks/index.html"),
        settings: resolve(__dirname, "src/renderer/settings/index.html"),
        stickers: resolve(__dirname, "src/renderer/sticker-manager/index.html"),
        call: resolve(__dirname, "src/renderer/call/index.html"),
        "chat-react": resolve(__dirname, "src/renderer/react/index.html"),
        music: resolve(__dirname, "src/renderer/music/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
