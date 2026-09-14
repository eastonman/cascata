import { expect, test } from "@playwright/test";
import { canvasStats, importFixture, paneCanvas, restPointer, waitForAnalysis } from "./helpers";

test("both panes hold their own audio", async ({ page }) => {
  await page.goto("/");
  await page.locator("#compare").click();

  await importFixture(page, 0);
  await waitForAnalysis(page);
  await importFixture(page, 1);
  await waitForAnalysis(page);

  expect((await canvasStats(paneCanvas(page, 0))).litFraction).toBeGreaterThan(0.02);
  expect((await canvasStats(paneCanvas(page, 1))).litFraction).toBeGreaterThan(0.02);
});

test("leaving compare mode keeps pane B's audio", async ({ page }) => {
  // The rule this protects: Clear is the only thing in the app that destroys
  // audio. A mode toggle must not quietly discard an imported file.
  await page.goto("/");
  await page.locator("#compare").click();
  await importFixture(page, 1);
  await waitForAnalysis(page);
  const before = await canvasStats(paneCanvas(page, 1));

  await page.locator("#compare").click();
  await expect(page.locator(".pane").nth(1)).toBeHidden();
  await page.locator("#compare").click();
  await expect(page.locator(".pane").nth(1)).toBeVisible();

  const after = await canvasStats(paneCanvas(page, 1));
  expect(after.litFraction).toBeGreaterThan(before.litFraction * 0.8);
});

test("clearing one pane leaves the other alone", async ({ page }) => {
  await page.goto("/");
  await page.locator("#compare").click();
  await importFixture(page, 0);
  await waitForAnalysis(page);
  await importFixture(page, 1);
  await waitForAnalysis(page);

  const keptBefore = await canvasStats(paneCanvas(page, 0));
  await page
    .locator(".pane")
    .nth(1)
    .getByRole("button", { name: /^Clear pane/ })
    .click();

  await expect(page.locator(".pane").nth(1).locator(".pane-hint")).toBeVisible();
  await expect(page.locator(".pane").nth(0).locator(".pane-hint")).toBeHidden();
  const keptAfter = await canvasStats(paneCanvas(page, 0));
  expect(keptAfter.litFraction).toBeGreaterThan(keptBefore.litFraction * 0.8);
});

test("Link is unavailable outside compare mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#link")).toBeDisabled();
  await page.locator("#compare").click();
  await expect(page.locator("#link")).toBeEnabled();
});

test("linking does not move either pane", async ({ page }) => {
  // The whole design of the offset: it is taken from where the panes already
  // are, so pressing Link freezes the alignment rather than imposing one.
  await page.goto("/");
  await page.locator("#compare").click();
  await importFixture(page, 0);
  await waitForAnalysis(page);
  await importFixture(page, 1);
  await waitForAnalysis(page);

  // Zoom in first. An import pins both panes at the file's start, and at 1x a
  // 30 s file leaves only about 120 columns of travel before the view reaches
  // the end -- not enough room for a drag to mean anything.
  await page.getByLabel("Zoom").selectOption("4");

  // Then move B forward through the file, leftward: the view sits at the start,
  // so there is nothing earlier to reveal by dragging the other way.
  const b = paneCanvas(page, 1);
  const box = (await b.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  await restPointer(page);
  const beforeA = await canvasStats(paneCanvas(page, 0));
  const beforeB = await canvasStats(b);

  await page.locator("#link").click();
  await expect(page.locator("#status")).toContainText("linked");
  await restPointer(page);

  // Identical, not merely similar: the offset is taken from the current
  // positions precisely so that linking is a no-op on screen.
  expect((await canvasStats(paneCanvas(page, 0))).fingerprint).toBe(beforeA.fingerprint);
  expect((await canvasStats(b)).fingerprint).toBe(beforeB.fingerprint);
});

test("linked panes scroll together", async ({ page }) => {
  await page.goto("/");
  await page.locator("#compare").click();
  await importFixture(page, 0);
  await waitForAnalysis(page);
  await importFixture(page, 1);
  await waitForAnalysis(page);

  await page.getByLabel("Zoom").selectOption("4");
  await page.locator("#link").click();
  await restPointer(page);
  const unmovedB = await canvasStats(paneCanvas(page, 1));

  // Drag pane A forward through the file; B must follow, so its picture changes.
  const a = paneCanvas(page, 0);
  const box = (await a.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  await restPointer(page);
  const movedB = await canvasStats(paneCanvas(page, 1));
  expect(movedB.fingerprint).not.toBe(unmovedB.fingerprint);
});

test("arming decides which pane the status bar describes", async ({ page }) => {
  await page.goto("/");
  await page.locator("#compare").click();
  await importFixture(page, 1);
  await waitForAnalysis(page);

  await page
    .locator(".pane")
    .nth(1)
    .getByRole("button", { name: /^Record into pane B/ })
    .click();
  await expect(page.locator("#status")).toContainText("· B ·");
});
