import { expect, test } from "@playwright/test";
import {
  canvasStats,
  importFixture,
  paneCanvas,
  pitchCurveRows,
  restPointer,
  waitForAnalysis,
} from "./helpers";

test("the display frequency limit crops without recomputing", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  const canvas = paneCanvas(page);
  const at5k = await canvasStats(canvas);

  await page.getByLabel("Max freq").selectOption("2000");
  const at2k = await canvasStats(canvas);
  expect(at2k.fingerprint).not.toBe(at5k.fingerprint);
  // Cropping is instant: there is no analysis to redo, so the status bar never
  // goes back to Analysing.
  await expect(page.locator("#status")).not.toContainText("Analysing");

  await page.getByLabel("Max freq").selectOption("5000");
  expect((await canvasStats(canvas)).fingerprint).toBe(at5k.fingerprint);
});

test("the dB floor and range change contrast across the whole history", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  const canvas = paneCanvas(page);
  const wide = await canvasStats(canvas);

  // Narrowing the range makes everything pop, which is the cheap alternative
  // to a high-contrast colormap.
  const range = page.getByLabel("Range");
  await range.fill("30");
  await range.dispatchEvent("change");
  await restPointer(page);

  const narrow = await canvasStats(canvas);
  expect(narrow.fingerprint).not.toBe(wide.fingerprint);
  expect(narrow.litFraction).toBeGreaterThan(wide.litFraction);
});

test("the pitch checkbox shows and hides the curve", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  const canvas = paneCanvas(page);

  const drawn = (rows: number[]) => rows.filter((r) => r >= 0).length;
  expect(drawn(await pitchCurveRows(canvas))).toBeGreaterThan(50);

  await page.getByRole("checkbox").uncheck();
  expect(drawn(await pitchCurveRows(canvas))).toBe(0);

  await page.getByRole("checkbox").check();
  expect(drawn(await pitchCurveRows(canvas))).toBeGreaterThan(50);
});

test("columns analysed with pitch off stay blank when it is turned back on", async ({ page }) => {
  // -1 means "never analysed" and is not the same as "silent". Switching the
  // overlay on does not retroactively compute what was skipped.
  await page.goto("/");
  await page.getByRole("checkbox").uncheck();
  await importFixture(page);
  await waitForAnalysis(page);

  const canvas = paneCanvas(page);
  const drawn = (rows: number[]) => rows.filter((r) => r >= 0).length;
  expect(drawn(await pitchCurveRows(canvas))).toBe(0);

  await page.getByRole("checkbox").check();
  // Still nothing: those columns hold -1, "never analysed", which the curve
  // treats as a break rather than something to fill in.
  expect(drawn(await pitchCurveRows(canvas))).toBe(0);
});

test("every display setting survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Window").selectOption("8192");
  await page.getByLabel("Max freq").selectOption("12000");
  await page.getByLabel("Colors").selectOption("turbo");
  await page.getByLabel("Zoom").selectOption("2");
  await page.getByLabel("A4").selectOption("442");
  await page.getByLabel("Split").selectOption("columns");
  await page.getByRole("checkbox").uncheck();

  await page.reload();

  await expect(page.getByLabel("Window")).toHaveValue("8192");
  await expect(page.getByLabel("Max freq")).toHaveValue("12000");
  await expect(page.getByLabel("Colors")).toHaveValue("turbo");
  await expect(page.getByLabel("Zoom")).toHaveValue("2");
  await expect(page.getByLabel("A4")).toHaveValue("442");
  await expect(page.getByLabel("Split")).toHaveValue("columns");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("A4 calibration moves the reference line", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  // The A4 gridline is the only blue-tinted horizontal line on the plot.
  const a4Row = () =>
    paneCanvas(page).evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const { width, height } = el;
      const data = ctx.getImageData(0, 0, width, height).data;
      const x = Math.floor(width * 0.55); // clear of the left-hand labels
      for (let y = 0; y < height; y++) {
        const p = (y * width + x) * 4;
        const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
        // A4_COLOR is rgba(120,200,255,.55) over a dark plot.
        if (b > 90 && b > r * 1.6 && g > r) return y;
      }
      return -1;
    });

  const at440 = await a4Row();
  expect(at440).toBeGreaterThan(0);

  await page.getByLabel("A4").selectOption("443");
  await restPointer(page);
  const at443 = await a4Row();

  expect(at443).toBeGreaterThan(0);
  // A higher reference pitch sits higher on the plot: a smaller row index.
  expect(at443).toBeLessThan(at440);
});
