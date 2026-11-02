import { defineConfig } from "vite";

// The app's home is revinetic.com/inspect-funnels/ (revinetic.com's worker serves it
// from this Pages project). Built files go in dist/inspect-funnels/ so the same paths
// work here too; scripts/finish-build.mjs puts _headers/_redirects at the dist root.
// The dev server stays at / so local testing is unchanged.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/inspect-funnels/" : "/",
  build: { outDir: "dist/inspect-funnels", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
}));
