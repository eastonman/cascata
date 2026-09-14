import { expect, test } from "@playwright/test";
import { canvasStats, importFixture, paneCanvas, restPointer, waitForAnalysis } from "./helpers";

/**
 * Finds the playhead, or -1 when it is not drawn.
 *
 * Colour alone is not enough: magma's hot band sits around rgb(241,96,93),
 * which is a hair away from the composited playhead. What separates them is
 * that the playhead is a solid line spanning the whole plot, so it holds its
 * colour down the entire column while spectrogram content never does. The
 * dashed white cursor is excluded by the same rule.
 *
 * What this cannot check is whether the audio you hear lines up with the line
 * you see. That needs ears and stays manual.
 */
async function playheadX(page: import("@playwright/test").Page): Promise<number> {
  return paneCanvas(page).evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;

    // rgba(255,120,120,.95) over any background lands in r>=242, g and b both
    // near 114 and within ~13 of each other.
    const isPlayhead = (x: number, y: number) => {
      const p = (y * width + x) * 4;
      const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
      return r >= 238 && g >= 105 && g <= 132 && b >= 105 && b <= 132 && Math.abs(g - b) <= 14;
    };

    const rows: number[] = [];
    for (let f = 0.08; f <= 0.92; f += 0.02) rows.push(Math.floor(height * f));

    let best = -1;
    let bestHits = 0;
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (const y of rows) if (isPlayhead(x, y)) hits++;
      if (hits > bestHits) {
        bestHits = hits;
        best = x;
      }
    }
    return bestHits >= rows.length * 0.85 ? best : -1;
  });
}

test("clicking sets the play cursor", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  const canvas = paneCanvas(page);
  const before = await canvasStats(canvas);

  // Near the right edge, where the audio is: a clip shorter than the viewport
  // sits against that edge, and how much of the canvas it covers depends on
  // the device sample rate.
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  await restPointer(page);

  expect((await canvasStats(canvas)).fingerprint).not.toBe(before.fingerprint);
});

test("the playhead advances while playing and stops on Escape", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  // Inside the audio but with room to the right to travel: a clip shorter than
  // the viewport is pinned to the right edge, so how far left the audio starts
  // depends on the device sample rate.
  const box = (await paneCanvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
  await restPointer(page);

  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveText("Stop");

  await page.waitForTimeout(400);
  const early = await playheadX(page);
  expect(early).toBeGreaterThan(0);

  await page.waitForTimeout(1200);
  const later = await playheadX(page);
  expect(later).toBeGreaterThan(early);

  await page.keyboard.press("Escape");
  await expect(page.locator("#play")).toHaveText("Play");
  // Gone from the plot once stopped. Polled rather than sampled once: the
  // button flips synchronously but the canvas only catches up on the next
  // frame, and a line left frozen on the plot would still fail here.
  await expect.poll(() => playheadX(page)).toBe(-1);
});

test("the arrow keys pan and Shift pans further", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  await page.getByLabel("Zoom").selectOption("4");
  await waitForAnalysis(page);

  const canvas = paneCanvas(page);
  const start = await canvasStats(canvas);

  // An imported file opens at its beginning, so there is nowhere to go left:
  // the forward key is the one with room.
  await page.keyboard.press("ArrowRight");
  await restPointer(page);
  const oneStep = await canvasStats(canvas);
  expect(oneStep.fingerprint).not.toBe(start.fingerprint);

  await page.keyboard.press("ArrowLeft");
  await restPointer(page);
  expect((await canvasStats(canvas)).fingerprint).toBe(start.fingerprint);

  // Shift covers five times the distance, so one shifted press lands somewhere
  // a single unshifted press cannot.
  await page.keyboard.press("Shift+ArrowRight");
  await restPointer(page);
  expect((await canvasStats(canvas)).fingerprint).not.toBe(oneStep.fingerprint);
});

test("Follow returns to the live edge after panning", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  await page.getByLabel("Zoom").selectOption("4");
  await waitForAnalysis(page);

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#status")).toContainText("pinned");
  await expect(page.locator("#follow")).toBeEnabled();

  await page.locator("#follow").click();
  await expect(page.locator("#status")).toContainText("live");
  await expect(page.locator("#follow")).toBeDisabled();
});

test("the exported file is a valid mono 16-bit WAV", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);

  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const wav = Buffer.concat(chunks);

  // Parsed rather than weighed: a file of the right size with a broken header
  // is exactly what "it downloaded fine" would miss.
  expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
  expect(wav.subarray(12, 16).toString("ascii")).toBe("fmt ");
  expect(wav.readUInt16LE(20)).toBe(1); // PCM
  expect(wav.readUInt16LE(22)).toBe(1); // mono
  expect(wav.readUInt16LE(34)).toBe(16); // bits per sample

  const rate = wav.readUInt32LE(24);
  expect(rate).toBeGreaterThan(8000);
  expect(wav.readUInt32LE(28)).toBe(rate * 2); // byte rate
  expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);

  // And it holds audio rather than silence.
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  expect(peak).toBeGreaterThan(3000);
});
