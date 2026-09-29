import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve("index.html"),
        heatmap: resolve("heatmap/index.html"),
        valuemap: resolve("valuemap/index.html"),
        ratings: resolve("ratings/index.html"),
        financials: resolve("ratings/financials/index.html"),
        industrials: resolve("ratings/industrials/index.html"),
        utilities: resolve("ratings/utilities/index.html"),
        durables: resolve("ratings/durables/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
