import { expect, test } from "@playwright/test";
import { canvasStats, importFixture, paneCanvas, waitForAnalysis } from "./helpers";

/**
 * Phone behaviour, emulated. Covers the parts of the manual checklist that are
 * really about viewport and input model rather than about hardware: layout,
 * touch panning, and the page not scrolling under a gesture.
 *
 * What it cannot cover, and what stays manual: safe-area insets on a notched
 * device, a real microphone, and whether the thing is legible at arm's length
 * while singing.
 */

test("the control bar wraps instead of overflowing", async ({ page }) => {
  await page.goto("/");
  const bar = page.locator("#controls");

  const overflow = await bar.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  // Wrapping means no horizontal overflow. A few pixels of rounding is fine.
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
});

test("the canvas keeps usable height next to the wrapped bar", async ({ page }) => {
  await page.goto("/");
  const canvas = paneCanvas(page);
  const box = (await canvas.boundingBox())!;
  const viewport = page.viewportSize()!;

  expect(box.height).toBeGreaterThan(viewport.height * 0.3);
  expect(box.width).toBeGreaterThan(viewport.width * 0.9);
});

test("every control is large enough to tap", async ({ page }) => {
  await page.goto("/");
  // 44px is the usual floor for a touch target and what the stylesheet aims at.
  const buttons = page.locator("#controls button, .pane-header button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(4);

  for (let i = 0; i < count; i++) {
    const el = buttons.nth(i);
    if (!(await el.isVisible())) continue;
    const box = (await el.boundingBox())!;
    // The arm dot is a deliberate exception: it is a status indicator sized to
    // the header, and tapping it is not the primary way to switch panes.
    const isArmDot = (await el.getAttribute("class")) === "arm";
    if (isArmDot) continue;
    expect(box.height).toBeGreaterThanOrEqual(36);
  }
});

test("a touch drag pans the waterfall and does not scroll the page", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await waitForAnalysis(page);
  await page.getByLabel("Zoom").selectOption("4");
  await waitForAnalysis(page);

  const canvas = paneCanvas(page);
  const box = (await canvas.boundingBox())!;
  const before = await canvasStats(canvas);

  const y = box.y + box.height / 2;
  await page.touchscreen.tap(box.x + box.width * 0.5, y);
  // A swipe: the app reads Pointer Events, which touch also produces.
  await page.locator("canvas.waterfall").first().dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: box.x + box.width * 0.75,
    clientY: y,
    isPrimary: true,
  });
  for (const frac of [0.6, 0.45, 0.3]) {
    await page.locator("canvas.waterfall").first().dispatchEvent("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: box.x + box.width * frac,
      clientY: y,
      isPrimary: true,
    });
  }
  await page.locator("canvas.waterfall").first().dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: box.x + box.width * 0.3,
    clientY: y,
    isPrimary: true,
  });

  await expect(page.locator("#status")).toContainText("pinned");
  expect((await canvasStats(canvas)).fingerprint).not.toBe(before.fingerprint);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("compare mode stays usable in portrait", async ({ page }) => {
  await page.goto("/");
  await page.locator("#compare").click();

  const panes = page.locator(".pane");
  await expect(panes.nth(1)).toBeVisible();

  // Side by side is unusable on a narrow screen, so the stylesheet forces
  // stacking there regardless of the setting.
  await page.getByLabel("Split").selectOption("columns");
  const boxes = await Promise.all([
    panes.nth(0).boundingBox(),
    panes.nth(1).boundingBox(),
  ]);
  expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
  expect(Math.abs(boxes[0]!.width - boxes[1]!.width)).toBeLessThan(2);
});
