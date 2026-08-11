/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,

  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    cors: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : {
          host: "localhost",
          port: 1421,
        },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: {
    alias: {
      "@framework": path.resolve(__dirname, "src/lib/framework"),
    },
  },

  // Vitest 配置
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },

  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        settings: path.resolve(__dirname, "settings.html"),
      },
      output: {
        // 代码分割：将大依赖分离为独立 chunk，优化缓存和加载
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react/jsx-runtime'],
          'vendor-motion': ['framer-motion'],
          'vendor-tauri': ['@tauri-apps/api'],
          'vendor-settings': [
            'react-router-dom',
            'react-i18next',
            'i18next',
            'i18next-browser-languagedetector',
          ],
          'vendor-iconify': ['@iconify/react', '@iconify-json/solar'],
        },
      },
    },
  },
}));
