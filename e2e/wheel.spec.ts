import { expect, test } from "@playwright/test";
import { canvasStats, importFixture, paneCanvas, restPointer, waitForAnalysis } from "./helpers";

/** Puts the view somewhere with room to move in both directions. */
async function importAndZoom(page: import("@playwright/test").Page) {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  // At 1x a 30 s file barely overflows the viewport; 4x leaves real travel.
  await page.getByLabel("Zoom").selectOption("4");
  await waitForAnalysis(page);
}

test("the wheel scrolls the waterfall horizontally", async ({ page }) => {
  await importAndZoom(page);
  const canvas = paneCanvas(page);
  const box = (await canvas.boundingBox())!;

  await restPointer(page);
  const before = await canvasStats(canvas);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await restPointer(page);

  await expect(page.locator("#status")).toContainText("pinned");
  const after = await canvasStats(canvas);
  expect(after.fingerprint).not.toBe(before.fingerprint);
});

test("scrolling back returns to where it started", async ({ page }) => {
  await importAndZoom(page);
  const canvas = paneCanvas(page);
  const box = (await canvas.boundingBox())!;

  // Move off the live edge first, so there is room to scroll in both
  // directions and the reversal is not clamped at a bound.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await restPointer(page);
  const anchored = await canvasStats(canvas);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await restPointer(page);
  expect((await canvasStats(canvas)).fingerprint).not.toBe(anchored.fingerprint);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await restPointer(page);
  expect((await canvasStats(canvas)).fingerprint).toBe(anchored.fingerprint);
});

test("a linked pane follows a wheel scroll in the other one", async ({ page }) => {
  await page.goto("/");
  await page.locator("#compare").click();
  await importFixture(page, 0);
  await waitForAnalysis(page);
  await importFixture(page, 1);
  await waitForAnalysis(page);
  await page.getByLabel("Zoom").selectOption("4");
  await waitForAnalysis(page);

  await page.locator("#link").click();
  await restPointer(page);
  const beforeB = await canvasStats(paneCanvas(page, 1));

  const a = paneCanvas(page, 0);
  const box = (await a.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await restPointer(page);

  // The wheel goes through the same path as a drag, so mirroring applies.
  expect((await canvasStats(paneCanvas(page, 1))).fingerprint).not.toBe(beforeB.fingerprint);
});

test("the wheel does not scroll the page itself", async ({ page }) => {
  await importAndZoom(page);
  const canvas = paneCanvas(page);
  const box = (await canvas.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await restPointer(page);

  // Without preventDefault on a non-passive listener, the document scrolls
  // and the canvas moves out from under the pointer.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
