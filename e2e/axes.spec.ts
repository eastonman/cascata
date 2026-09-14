import { type Page, expect, test } from "@playwright/test";
import { OCTAVE_TONES, makeOctavesWav } from "./fixture";
import {
  columnEnergy,
  importWav,
  paneCanvas,
  restPointer,
  type Run,
  energyRuns,
  waitForAnalysis,
} from "./helpers";

/**
 * Reads back the vertical centre of each tone band, low to high, keeping only
 * the strongest `want` of them.
 *
 * Two things make this measurable rather than fiddly. Brightness is sampled as
 * the difference between sounding columns and silent ones, so the octave
 * gridlines and the A4 line -- which are drawn over every column and are
 * brighter than the tones -- cancel instead of being mistaken for signal. And
 * several columns are averaged on each side, so no single STFT frame decides
 * the answer.
 */
async function bandRows(page: Page, want: number): Promise<number[]> {
  const canvas = paneCanvas(page);

  // Locate the sounding passage rather than assuming it covers a fixed slice
  // of the canvas: its width in columns scales with the device sample rate,
  // and a clip shorter than the viewport is pinned to the right edge.
  const energy = await columnEnergy(canvas);
  const runs = energyRuns(energy);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  const loud = runs.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  const inset = Math.max(2, Math.floor((loud.to - loud.from) * 0.15));
  const sounds = { from: loud.from + inset, to: loud.to - inset };
  // Quiet columns for the reference profile, on whichever side has more room.
  const quiet =
    loud.from > energy.length - loud.to
      ? { from: Math.floor(loud.from * 0.1), to: Math.floor(loud.from * 0.9) }
      : { from: loud.to + inset, to: energy.length - 2 };
  expect(quiet.to - quiet.from).toBeGreaterThan(8);

  return canvas.evaluate(
    (
      el: HTMLCanvasElement,
      { want, sounds, quiet }: { want: number; sounds: Run; quiet: Run },
    ) => {
      const ctx = el.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const { width, height } = el;
      const data = ctx.getImageData(0, 0, width, height).data;

      const profile = ({ from, to }: Run) => {
        const rows: number[] = [];
        for (let y = 0; y < height; y++) {
          let sum = 0;
          for (let x = from; x < to; x++) {
            const p = (y * width + x) * 4;
            sum += data[p] + data[p + 1] + data[p + 2];
          }
          rows.push(sum / (to - from));
        }
        return rows;
      };

      const sounding = profile(sounds);
      const silent = profile(quiet);
      const diff = sounding.map((v, y) => Math.max(0, v - silent[y]));

      const peak = Math.max(...diff);
      const threshold = peak * 0.4;

      // Contiguous runs above the threshold, each reduced to its
      // brightness-weighted centre so a band a few pixels tall is not rounded
      // to whichever edge happened to be brighter.
      const bands: { centre: number; weight: number }[] = [];
      let start = -1;
      for (let y = 0; y <= height; y++) {
        const lit = y < height && diff[y] >= threshold;
        if (lit && start < 0) start = y;
        if (!lit && start >= 0) {
          let weighted = 0;
          let weight = 0;
          for (let r = start; r < y; r++) {
            weighted += r * diff[r];
            weight += diff[r];
          }
          bands.push({ centre: weighted / weight, weight });
          start = -1;
        }
      }

      return bands
        .sort((a, b) => b.weight - a.weight)
        .slice(0, want)
        .map((b) => b.centre)
        .sort((a, b) => a - b);
    },
    { want, sounds, quiet },
  );
}

/** Gray is monotone in luminance, so brightness means intensity and nothing else. */
async function openWithTones(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Colors").selectOption("gray");
  // The pitch curve would lay a bright line over whichever tone YIN locks onto,
  // dragging that band's centre off the frequency it is meant to mark.
  await page.getByRole("checkbox").uncheck();
  await importWav(page, makeOctavesWav());
  await waitForAnalysis(page);
  await restPointer(page);
}

test("equal musical intervals occupy equal vertical distance", async ({ page }) => {
  await openWithTones(page);

  const rows = await bandRows(page, OCTAVE_TONES.length);
  expect(rows).toHaveLength(OCTAVE_TONES.length);

  // Sorted ascending, so rows[0] is the topmost band and therefore the highest
  // tone: the gaps run from high frequency down to low.
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i] - rows[i - 1]);
  for (const gap of gaps) expect(gap).toBeGreaterThan(20);

  // Three octaves, three gaps, all the same height: that is the axis being
  // logarithmic. A linear axis would give gaps in a 1:2:4 ratio instead.
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  for (const gap of gaps) expect(Math.abs(gap - mean)).toBeLessThan(mean * 0.12);
});

test("narrowing the frequency ceiling stretches the same intervals", async ({ page }) => {
  await openWithTones(page);

  const octaveHeight = async (max: string) => {
    await page.getByLabel("Max freq").selectOption(max);
    await restPointer(page);
    const rows = await bandRows(page, OCTAVE_TONES.length);
    expect(rows).toHaveLength(OCTAVE_TONES.length);
    return (rows[rows.length - 1] - rows[0]) / (OCTAVE_TONES.length - 1);
  };

  const wide = await octaveHeight("12000");
  const narrow = await octaveHeight("2000");
  expect(wide).toBeGreaterThan(0);

  // Same music, fewer octaves on screen, so each one gets more room. The plot
  // spans 55 Hz to the ceiling: 7.8 octaves at 12 kHz against 5.2 at 2 kHz, so
  // an octave should grow by about half.
  expect(narrow / wide).toBeGreaterThan(1.3);
  expect(narrow / wide).toBeLessThan(1.7);
});
