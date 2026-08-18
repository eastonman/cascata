import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true },
  build: {
    target: "es2022",
    // The AudioWorklet module must stay a real file. Vite inlines small assets
    // as base64 data URLs by default, and addModule() on a data: URL is
    // unreliable in Safari and blocked outright by any CSP that does not list
    // `data:` as a script source -- which the Android Tauri build will not
    // (DESIGN.md 2.3, 2.4).
    assetsInlineLimit: (filePath) => (filePath.includes("capture-worklet") ? false : undefined),
  },
});
