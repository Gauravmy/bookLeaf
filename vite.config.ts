import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The SPA is served by Express in production (same origin), so during
// development Vite proxies /api to the API server to mirror that setup.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
});
