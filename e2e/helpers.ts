import { expect, type Locator, type Page } from "@playwright/test";
import { makeToneWav } from "./fixture";

/** Imports the generated fixture into a pane by index. */
export async function importFixture(page: Page, paneIndex = 0): Promise<void> {
  const input = page.locator(".pane").nth(paneIndex).locator('input[type="file"]');
  await input.setInputFiles({
    name: "tone.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(makeToneWav()),
  });
  // The status bar reports the import before analysis starts.
  await expect(page.locator("#status")).toContainText("imported", { timeout: 15_000 });
}

/** Waits for the analysis backlog to drain, so the canvas is fully painted. */
export async function waitForAnalysis(page: Page): Promise<void> {
  await expect(page.locator("#status")).not.toContainText("Analysing", { timeout: 30_000 });
  await settle(page);
}

export interface CanvasStats {
  /** Fraction of sampled pixels that are not the colormap floor. */
  litFraction: number;
  /** Mean row index (0 = top) of lit pixels, or -1 when nothing is lit. */
  meanLitRow: number;
  /**
   * Content hash of the sampled pixels.
   *
   * litFraction is a poor test for "did the view move": scrolling a waterfall
   * past similar material barely changes how much of it is lit. A hash changes
   * whenever the picture does, which is the actual question.
   */
  fingerprint: number;
  width: number;
  height: number;
}

/**
 * Waits for the draw loop to actually repaint.
 *
 * Nothing in the app paints synchronously: a colormap change only invalidates
 * the offscreen ring, and the status bar stops saying "Analysing" in the same
 * tick that draws the last columns. Sampling without this reads the frame
 * before the one under test.
 */
export async function settle(page: Page, frames = 3): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/**
 * Gets the page ready to be sampled: pointer away, last frame drawn.
 *
 * Two separate hazards, both of which produced intermittent failures:
 * the crosshair follows the mouse and is redrawn every frame, so a pointer
 * left over a pane makes every fingerprint differ for the wrong reason; and
 * an interaction only mutates state, with the repaint deferred to the next
 * animation frame, so sampling straight after a wheel or a drag reads the
 * frame before the one under test.
 *
 * The frame wait also lives in canvasStats, so a sample can never be taken
 * without one. This exists for the pointer, and for the cases that want the
 * crosshair gone before anything else happens.
 */
export async function restPointer(page: Page): Promise<void> {
  await page.mouse.move(5, 5);
  await page.locator("#status").hover().catch(() => {});
  await settle(page);
}

/**
 * Samples the rendered canvas.
 *
 * Pixel statistics rather than a screenshot comparison: the waterfall's exact
 * colours depend on the device sample rate and on font rendering in the
 * overlay, so a reference image would be brittle across machines while telling
 * us less. What matters is whether anything was drawn and roughly where.
 *
 * Waits for a frame first. Nothing in the app paints synchronously, so an
 * interaction leaves the canvas showing the previous frame until the draw loop
 * runs; sampling without this is a race that a call site can lose without
 * ever being wrong about anything else.
 */
export async function canvasStats(canvas: Locator): Promise<CanvasStats> {
  await settle(canvas.page());
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;

    let lit = 0;
    let rowSum = 0;
    let sampled = 0;
    let hash = 2166136261; // FNV-1a
    // Every 4th pixel in each direction: enough signal, a 16th of the work.
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const p = (y * width + x) * 4;
        sampled++;
        // The magma floor is near-black; anything appreciably brighter is data
        // or an overlay line.
        const sum = data[p] + data[p + 1] + data[p + 2];
        if (sum > 90) {
          lit++;
          rowSum += y;
        }
        // Quantised so sub-unit antialiasing noise does not dominate.
        hash = ((hash ^ (sum >> 3)) * 16777619) >>> 0;
      }
    }
    return {
      litFraction: sampled === 0 ? 0 : lit / sampled,
      meanLitRow: lit === 0 ? -1 : rowSum / lit,
      fingerprint: hash,
      width,
      height,
    };
  });
}

export function paneCanvas(page: Page, paneIndex = 0): Locator {
  return page.locator(".pane").nth(paneIndex).locator("canvas.waterfall");
}
