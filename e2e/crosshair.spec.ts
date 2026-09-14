import { type Page, expect, test } from "@playwright/test";
import { importFixture, paneCanvas, settle, waitForAnalysis } from "./helpers";

/**
 * What the readout *says* is a pure function of the hovered point, and is
 * covered by the formatReadout and freqToY unit tests. What cannot be checked
 * there is the wiring: that hovering draws the thing at all, and that the box
 * flips sides rather than running off the canvas. Both are visible in pixels.
 *
 * The text is rgba(255,255,255,.92) over a 72% black box, so it composites to a
 * neutral grey near 235 on every channel. No colormap reaches that: magma and
 * viridis both top out with blue far below their red and green.
 */
async function readoutPixels(page: Page, box: { x: number; y: number; w: number; h: number }) {
  await settle(page);
  return paneCanvas(page).evaluate(
    (el: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }) => {
      const ctx = el.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const { width, height } = el;
      const data = ctx.getImageData(0, 0, width, height).data;

      // The caller works in CSS pixels, which is what the app draws in and
      // what boundingBox reports; getImageData is in device pixels. On a
      // Retina Mac those differ by two, and mixing them silently searched the
      // top-left quadrant for a box drawn outside it.
      const scale = width / el.clientWidth;
      const px = (v: number) => Math.round(v * scale);

      let count = 0;
      for (let y = Math.max(0, px(box.y)); y < Math.min(height, px(box.y + box.h)); y++) {
        for (let x = Math.max(0, px(box.x)); x < Math.min(width, px(box.x + box.w)); x++) {
          const p = (y * width + x) * 4;
          const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
          if (r > 200 && g > 200 && b > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 20) count++;
        }
      }
      return count;
    },
    box,
  );
}

test("hovering draws a readout and leaving removes it", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  const canvas = paneCanvas(page);
  const rect = (await canvas.boundingBox())!;
  const px = Math.round(rect.width * 0.4);
  const py = Math.round(rect.height * 0.5);
  // The box is drawn 8px right and below the cursor, and is 18px tall.
  const near = { x: px + 8, y: py + 8, w: 220, h: 18 };

  expect(await readoutPixels(page, near)).toBe(0);

  await page.mouse.move(rect.x + px, rect.y + py);
  expect(await readoutPixels(page, near)).toBeGreaterThan(20);

  await page.mouse.move(rect.x + rect.width / 2, rect.y - 30);
  expect(await readoutPixels(page, near)).toBe(0);
});

test("the readout box flips rather than running off the edge", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  const canvas = paneCanvas(page);
  const rect = (await canvas.boundingBox())!;
  // Bottom-right corner, where a box drawn down and to the right would be
  // entirely outside the plot.
  const px = Math.round(rect.width - 20);
  const py = Math.round(rect.height - 20);
  await page.mouse.move(rect.x + px, rect.y + py);

  const belowRight = await readoutPixels(page, { x: px + 8, y: py + 8, w: 220, h: 18 });
  const aboveLeft = await readoutPixels(page, { x: px - 230, y: py - 30, w: 222, h: 22 });

  expect(aboveLeft).toBeGreaterThan(20);
  expect(belowRight).toBe(0);
});
