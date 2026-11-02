import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const API = process.env.VITE_API_TARGET ?? "http://localhost:8787";

export default defineConfig({
  define: {
    __WEB_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version),
    __BUILD_REVISION__: JSON.stringify(process.env.BUILD_REVISION || null),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "发给自己",
        short_name: "发给自己",
        description: "自托管的跨设备收件箱",
        lang: "zh-CN",
        theme_color: "#bc4b2a",
        background_color: "#f2ece1",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/health": { target: API, changeOrigin: true },
    },
  },
});
