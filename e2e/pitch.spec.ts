import { expect, test } from "@playwright/test";
import { makeStereoWav, makeVibratoWav } from "./fixture";
import {
  importFixture,
  importWav,
  paneCanvas,
  pitchCurveRows,
  pitchRuns,
  restPointer,
  waitForAnalysis,
} from "./helpers";

/**
 * The tone fixture is A4, silence, A5, so the pitch curve comes out as exactly
 * two passages with a gap between them. Sliced that way rather than by canvas
 * position: how much of the canvas thirty seconds covers depends on the device
 * sample rate, so "the first third of the picture" is not "the first third of
 * the audio" on every machine. The passages are.
 */
async function tonePassages(page: import("@playwright/test").Page) {
  const rows = await pitchCurveRows(paneCanvas(page));
  const runs = pitchRuns(rows);
  const values = (r: { from: number; to: number }) =>
    rows.slice(r.from, r.to).filter((v) => v >= 0);
  return { rows, runs, values };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("a steady tone draws a steady line", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  await restPointer(page);

  const { runs, values } = await tonePassages(page);
  expect(runs.length).toBeGreaterThanOrEqual(1);

  // The first passage is a constant 440 Hz, so the curve there must be flat to
  // within a pixel or two of antialiasing.
  const first = values(runs[0]);
  expect(first.length).toBeGreaterThan(50);
  expect(Math.max(...first) - Math.min(...first)).toBeLessThan(6);
});

test("the line breaks during silence rather than bridging it", async ({ page }) => {
  // The fixture is 10 s of A4, 10 s of silence, 10 s of A5. A curve that
  // interpolated across the gap would read as a slow glide between two notes
  // that were never sung -- and would come back as one run, not two.
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  await restPointer(page);

  const { runs } = await tonePassages(page);
  expect(runs).toHaveLength(2);

  // The gap is a third of the audio, so it is comparable in width to the
  // passages on either side rather than being a dropout of a few columns.
  const gap = runs[1].from - runs[0].to;
  expect(gap).toBeGreaterThan((runs[0].to - runs[0].from) * 0.5);
});

test("the octave step appears as a jump, not a ramp", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  await restPointer(page);

  const { runs, values } = await tonePassages(page);
  expect(runs).toHaveLength(2);

  const first = values(runs[0]);
  const last = values(runs[1]);
  expect(first.length).toBeGreaterThan(30);
  expect(last.length).toBeGreaterThan(30);

  // A5 is an octave above A4, so it sits higher: a smaller row index. Both
  // passages are flat, and everything between them is blank -- there is no
  // ramp anywhere for the eye to follow.
  expect(median(last)).toBeLessThan(median(first));
  expect(Math.max(...last) - Math.min(...last)).toBeLessThan(8);
});

test("vibrato is shown as vibrato, not smoothed flat", async ({ page }) => {
  // DESIGN.md 5.2 refuses to smooth the curve because vibrato rate and depth
  // are what a singer is looking for. This is that refusal, asserted: a 5 Hz,
  // one-semitone wobble has to survive to the screen.
  await page.goto("/");
  await importWav(page, makeVibratoWav());
  await waitForAnalysis(page);
  await restPointer(page);

  const rows = (await pitchCurveRows(paneCanvas(page))).filter((r) => r >= 0);
  expect(rows.length).toBeGreaterThan(100);

  const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
  const spread = Math.max(...rows) - Math.min(...rows);

  // A semitone is about 1/12 of an octave; at the default 5 kHz ceiling an
  // octave is roughly 15% of the plot height, so the excursion is several
  // pixels. Flat would be under two.
  expect(spread).toBeGreaterThan(4);

  // And it oscillates rather than drifting: the curve crosses its own mean
  // many times over ten seconds at 5 Hz.
  let crossings = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1] < mean !== rows[i] < mean) crossings++;
  }
  expect(crossings).toBeGreaterThan(10);
});

test("a stereo file is downmixed rather than read as one channel", async ({ page }) => {
  // Left is 440 Hz, right is 1760 Hz. Averaging keeps both; taking one channel
  // would leave a single line where there should be two.
  await page.goto("/");
  await importWav(page, makeStereoWav());
  await waitForAnalysis(page);
  await restPointer(page);

  const canvas = paneCanvas(page);
  // The tone is continuous, so any column the pitch curve reached is inside
  // the audio -- which is how this finds a column to read without assuming
  // where on the canvas the clip landed.
  const rows = await pitchCurveRows(canvas);
  const runs = pitchRuns(rows);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  const column = Math.floor((runs[0].from + runs[0].to) / 2);

  const bands = await canvas.evaluate((el: HTMLCanvasElement, x: number) => {
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;

    // Rows that are lit in this column, grouped into contiguous runs.
    const runs: number[] = [];
    let inRun = false;
    for (let y = 0; y < height; y++) {
      const p = (y * width + x) * 4;
      const lit = data[p] + data[p + 1] + data[p + 2] > 150;
      if (lit && !inRun) runs.push(y);
      inRun = lit;
    }
    return runs;
  }, column);

  // Two tones two octaves apart give two separated bands. One channel only
  // would give one.
  expect(bands.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...bands) - Math.min(...bands)).toBeGreaterThan(30);
});
