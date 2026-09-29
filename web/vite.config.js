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
        communication: resolve("ratings/communication/index.html"),
        discretionary: resolve("ratings/discretionary/index.html"),
        staples: resolve("ratings/staples/index.html"),
        energy: resolve("ratings/energy/index.html"),
        healthcare: resolve("ratings/healthcare/index.html"),
        technology: resolve("ratings/technology/index.html"),
        materials: resolve("ratings/materials/index.html"),
        realestate: resolve("ratings/realestate/index.html"),
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
