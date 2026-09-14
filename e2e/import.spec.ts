import { expect, test } from "@playwright/test";
import { FIXTURE_SECONDS } from "./fixture";
import {
  canvasStats,
  columnEnergy,
  importFixture,
  paneCanvas,
  type Run,
  energyRuns,
  longestRuns,
  settle,
  waitForAnalysis,
} from "./helpers";

test("importing a file paints the waterfall", async ({ page }) => {
  await page.goto("/");
  const canvas = paneCanvas(page);

  const before = await canvasStats(canvas);
  expect(before.litFraction).toBeLessThan(0.05);

  await importFixture(page);
  await waitForAnalysis(page);

  const after = await canvasStats(canvas);
  // The fixture is two thirds tone, so a real spectrogram lights up a
  // noticeable share of the plot. An empty canvas or an all-floor one fails.
  expect(after.litFraction).toBeGreaterThan(before.litFraction + 0.02);
});

test("the octave step lands higher on the frequency axis", async ({ page }) => {
  // The fixture is A4, silence, A5. On a log frequency axis the second tone
  // must sit visibly above the first -- this is the check that catches the
  // axis being inverted, mis-scaled, or the log binning drifting.
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  // Locate the two sounding passages rather than slicing the canvas into
  // thirds: a clip's width in columns follows the device sample rate, and one
  // shorter than the viewport sits against the right edge, so a fixed third of
  // the picture is not a fixed third of the audio on every machine.
  const canvas = paneCanvas(page);
  const passages = longestRuns(energyRuns(await columnEnergy(canvas)), 2);
  expect(passages).toHaveLength(2);
  for (const p of passages) expect(p.to - p.from).toBeGreaterThan(50);

  const rows = await canvas.evaluate((el: HTMLCanvasElement, passages: Run[]) => {
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;

    const brightness = ({ from, to }: Run) => {
      const out = new Float64Array(height);
      for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = from; x < to; x += 2) {
          const p = (y * width + x) * 4;
          sum += data[p] + data[p + 1] + data[p + 2];
        }
        out[y] = sum / Math.max(1, (to - from) / 2);
      }
      return out;
    };

    // Differential, not absolute: the note ruler and the time axis are drawn
    // across the full width and are brighter than any tone, so an absolute
    // "brightest row" finds a gridline in both passages. Subtracting one from
    // the other cancels anything full-width and leaves the tones.
    const left = brightness(passages[0]);
    const right = brightness(passages[1]);

    const argmaxDiff = (a: Float64Array, b: Float64Array) => {
      let best = -1;
      let bestVal = 0;
      for (let y = 0; y < a.length; y++) {
        const d = a[y] - b[y];
        if (d > bestVal) {
          bestVal = d;
          best = y;
        }
      }
      return best;
    };

    return {
      a4Row: argmaxDiff(left, right),
      a5Row: argmaxDiff(right, left),
      height,
    };
  }, passages);

  expect(rows.a4Row).toBeGreaterThan(0);
  expect(rows.a5Row).toBeGreaterThan(0);
  // Row 0 is the top, so the higher pitch has the smaller row index. At the
  // default 5 kHz ceiling the octave is about 15% of the plot height apart.
  expect(rows.a5Row).toBeLessThan(rows.a4Row);
  expect(rows.a4Row - rows.a5Row).toBeGreaterThan(rows.height * 0.05);
});

test("a file that cannot be decoded leaves the previous audio alone", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  const good = await canvasStats(paneCanvas(page));

  await page.locator(".pane").first().locator('input[type="file"]').setInputFiles({
    name: "not-audio.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("this is definitely not a RIFF header"),
  });

  await expect(page.locator("#status")).toContainText("Could not read", { timeout: 15_000 });
  // The point of decoding before tearing the old stores down.
  const after = await canvasStats(paneCanvas(page));
  expect(after.litFraction).toBeGreaterThan(good.litFraction * 0.8);
});

test("clear empties the pane and disables what depends on audio", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  const pane = page.locator(".pane").first();
  await pane.getByRole("button", { name: /^Clear pane/ }).click();

  await expect(page.locator("#status")).toContainText("cleared");
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#export")).toBeDisabled();
  await expect(pane.locator(".pane-hint")).toBeVisible();

  const after = await canvasStats(paneCanvas(page));
  expect(after.litFraction).toBeLessThan(0.05);
});

test("export produces a wav whose size matches the imported audio", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^cascata-A-\d+s\.wav$/);
  const stream = await file.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += (chunk as Buffer).length;

  // 30 s of 16-bit mono at the device rate, plus a 44-byte header. The device
  // rate is whatever the machine's output is -- a Bluetooth headset forces
  // 16 kHz -- so this brackets the plausible range rather than naming one. The
  // bound is inclusive because 16 kHz is a real configuration, not a floor to
  // sit strictly above.
  expect(bytes).toBeGreaterThanOrEqual(44 + FIXTURE_SECONDS * 8000 * 2);
  expect(bytes).toBeLessThan(44 + FIXTURE_SECONDS * 48000 * 2 + 4096);
});

test("the turbo colormap renders in blue and green where magma does not", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  const hueMix = () =>
    paneCanvas(page).evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const { width, height } = el;
      const data = ctx.getImageData(0, 0, width, height).data;
      let green = 0;
      let blue = 0;
      for (let i = 0; i < data.length; i += 4 * 7) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r + g + b < 60) continue; // colormap floor
        if (g > r * 1.5 && g > b * 1.5) green++;
        if (b > r * 1.5 && b > g * 1.5) blue++;
      }
      return { green, blue };
    });

  const magma = await hueMix();
  await page.getByLabel("Colors").selectOption("turbo");
  await settle(page);
  const turbo = await hueMix();

  // magma runs black-purple-orange-white: no green at all, and its purple is
  // never blue-dominant by this margin.
  expect(turbo.green).toBeGreaterThan(magma.green + 50);
  expect(turbo.blue).toBeGreaterThan(magma.blue + 50);
});
