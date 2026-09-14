import { expect, type Locator, type Page } from "@playwright/test";
import { makeToneWav } from "./fixture";

/** Imports a generated WAV into a pane by index. */
export async function importWav(page: Page, bytes: Uint8Array, paneIndex = 0): Promise<void> {
  const input = page.locator(".pane").nth(paneIndex).locator('input[type="file"]');
  await input.setInputFiles({
    name: "fixture.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(bytes),
  });
  // The status bar reports the import before analysis starts.
  await expect(page.locator("#status")).toContainText("imported", { timeout: 15_000 });
}

/** Imports the standard tone/silence/tone fixture. */
export async function importFixture(page: Page, paneIndex = 0): Promise<void> {
  await importWav(page, makeToneWav(), paneIndex);
}

/**
 * Waits for the analysis backlog to drain, so the canvas is fully painted.
 *
 * Waits for the resting state line to appear rather than for "Analysing" to
 * be absent. The negative form has a gap in it: the import message is posted
 * and holds the status bar for a moment before the first column is owed, so a
 * glance in that window sees no "Analysing" and returns before any analysis
 * has begun. That produced failures only under parallel load, where the window
 * is widest, which is the worst way to find out.
 *
 * "buffered" only ever appears in the state line, and statusText writes that
 * line only when nothing is owed and no message is holding the bar -- so it is
 * a positive signal for exactly the condition wanted.
 */
export async function waitForAnalysis(page: Page): Promise<void> {
  await expect(page.locator("#status")).toContainText("buffered", { timeout: 30_000 });
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

/**
 * Lit-pixel count for every canvas column.
 *
 * Where a fixture lands on screen is not a constant, and assuming it is has
 * cost this suite a day. The analysis grid is HOP samples per column, so a
 * clip's width in columns scales with the *device* sample rate — a Bluetooth
 * headset forces 16 kHz, and the same thirty seconds then covers a third of
 * the width it covers at 48 kHz. Shorter than the viewport, it sits against
 * the right edge rather than stretching to fill.
 *
 * So a test that slices the canvas into thirds is really asserting something
 * about the machine it runs on. Locate the audio first, then slice that.
 */
export async function columnEnergy(canvas: Locator): Promise<number[]> {
  await settle(canvas.page());
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;

    const out: number[] = [];
    for (let x = 0; x < width; x++) {
      let lit = 0;
      for (let y = 0; y < height; y += 2) {
        const p = (y * width + x) * 4;
        if (data[p] + data[p + 1] + data[p + 2] > 90) lit++;
      }
      out.push(lit);
    }
    return out;
  });
}

export interface Run {
  from: number;
  to: number;
}

/**
 * A cut that separates signal from background, `fraction` of the way between.
 *
 * Deliberately not a fraction of the maximum. Every fixture starts and stops
 * its tones abruptly, and a discontinuity is broadband: the onset column is
 * lit from top to bottom and is far brighter than the steady tone that
 * follows. Measured against that peak, the tone itself looks like background.
 * Percentiles ignore the few extreme columns and describe the two levels that
 * actually matter.
 */
export function signalThreshold(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const floor = at(0.1);
  const top = at(0.9);
  return top <= floor ? Number.POSITIVE_INFINITY : floor + (top - floor) * fraction;
}

/**
 * Contiguous ranges of `values` at or above `threshold`.
 *
 * The fixtures are built so their sounding passages come out as separate runs,
 * which is a far steadier thing to slice on than a fraction of the canvas.
 * Runs shorter than `minLength` are dropped so a stray antialiased column is
 * not mistaken for a passage.
 */
export function runsAbove(values: number[], threshold: number, minLength = 4): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const above = i < values.length && values[i] >= threshold && values[i] > 0;
    if (above && start < 0) start = i;
    if (!above && start >= 0) {
      if (i - start >= minLength) runs.push({ from: start, to: i });
      start = -1;
    }
  }
  return runs;
}

/** The column ranges the audio occupies, `fraction` of the way above background. */
export function energyRuns(energy: number[], fraction = 0.35, minLength = 4): Run[] {
  return runsAbove(energy, signalThreshold(energy, fraction), minLength);
}

/**
 * The `n` widest runs, back in positional order.
 *
 * The note ruler draws its labels inside the plot, and a column through a
 * glyph is lit like a column of audio — a dozen of them at the left edge. The
 * passages being looked for are hundreds of columns wide, so width is what
 * tells them apart, not brightness.
 */
export function longestRuns(runs: Run[], n: number): Run[] {
  return [...runs]
    .sort((a, b) => b.to - b.from - (a.to - a.from))
    .slice(0, n)
    .sort((a, b) => a.from - b.from);
}

/** The passages where the pitch curve was drawn, as column ranges. */
export function pitchRuns(rows: number[], minLength = 8): Run[] {
  return runsAbove(
    rows.map((r) => (r >= 0 ? 1 : 0)),
    1,
    minLength,
  );
}

/**
 * The row the YIN curve occupies in each canvas column, or -1 where absent.
 *
 * Scans every column at full resolution rather than reusing canvasStats: the
 * curve is a 1.5 px line, and the fingerprint samples every fourth pixel, so
 * it misses the curve almost entirely. A test that diffed fingerprints to
 * check the curve was drawn would pass whether or not it was.
 */
export async function pitchCurveRows(canvas: Locator): Promise<number[]> {
  await settle(canvas.page());
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;

    const rows: number[] = [];
    for (let x = 0; x < width; x++) {
      let found = -1;
      for (let y = 0; y < height; y++) {
        const p = (y * width + x) * 4;
        const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
        // PITCH_COLOR is rgba(90,255,170,.95): green-dominant with a strong
        // blue component, which separates it from both colormaps' greens.
        if (g > 200 && r > 40 && r < 160 && b > 110 && b < 220) {
          found = y;
          break;
        }
      }
      rows.push(found);
    }
    return rows;
  });
}
