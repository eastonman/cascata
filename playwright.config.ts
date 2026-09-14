import { defineConfig, devices } from "@playwright/test";
import { FIXTURE_WAV } from "./e2e/fixture";

/**
 * Browser tests for the ~1100 lines that unit tests cannot reach: the draw
 * loop, the capture lifecycle, and everything that needs a real canvas.
 *
 * Both engines run, and WebKit is the point. DESIGN.md §2.3 makes it the
 * compatibility baseline, and every Safari-only bug found so far — a blocked
 * `localStorage` that took the whole app down at boot, an AudioContext stuck
 * in WebKit's non-standard "interrupted" state, an AudioWorklet that will not
 * load from a `data:` URL — was found by hand, late. This is the first thing
 * in the project that checks it automatically.
 *
 * Browsers come from the Nix flake, not from `playwright install`, so CI and a
 * laptop run the same build. `@playwright/test` in package.json is pinned
 * exactly for the same reason: Playwright refuses to launch a browser whose
 * revision its package does not expect.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    // 127.0.0.1, not localhost. Vite's preview server binds IPv4 only, and
    // WebKit resolves localhost to ::1 first -- so every navigation timed out
    // under WebKit on Linux while Chromium, which falls back to IPv4, was
    // fine. A literal address removes the ambiguity rather than depending on
    // each engine's resolver order.
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    video: "off",
  },

  // The production build, not the dev server: a bundling mistake that only
  // shows up after tree-shaking — the AudioWorklet inlined as a data: URL was
  // exactly that — is invisible against `vite dev`.
  webServer: {
    command: "bun run build && bun run preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            // Grants the microphone without a prompt and feeds it a known WAV,
            // which is the only way to exercise the capture path at all.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${FIXTURE_WAV}`,
          ],
        },
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
