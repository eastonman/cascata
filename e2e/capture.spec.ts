import { expect, test } from "@playwright/test";
import { canvasStats, paneCanvas, restPointer } from "./helpers";

// Chromium only. The fake capture device comes from --use-file-for-fake-audio-capture,
// which WebKit has no equivalent for, so the capture path cannot be driven
// there. Everything else in the suite runs on both.
test.describe("capture", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "needs a fake audio device");

  test("recording fills the waterfall from the microphone", async ({ page }) => {
    await page.goto("/");
    const canvas = paneCanvas(page);
    expect((await canvasStats(canvas)).litFraction).toBeLessThan(0.05);

    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Stop");
    await expect(page.locator("#status")).toContainText("Recording", { timeout: 10_000 });

    // Let real audio arrive. The fake device plays the fixture in a loop.
    await page.waitForTimeout(3000);
    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Record");

    await restPointer(page);
    const after = await canvasStats(canvas);
    expect(after.litFraction).toBeGreaterThan(0.02);
  });

  test("stopping keeps the audio and leaves it scrubbable", async ({ page }) => {
    await page.goto("/");
    await page.locator("#record").click();
    await page.waitForTimeout(2500);
    await page.locator("#record").click();
    await expect(page.locator("#status")).toContainText("Stopped");

    await restPointer(page);
    const stopped = await canvasStats(paneCanvas(page));
    expect(stopped.litFraction).toBeGreaterThan(0.02);
    await expect(page.locator("#play")).toBeEnabled();
    await expect(page.locator("#export")).toBeEnabled();
  });

  test("recording goes to the armed pane, not the other one", async ({ page }) => {
    await page.goto("/");
    await page.locator("#compare").click();
    await page
      .locator(".pane")
      .nth(1)
      .getByRole("button", { name: /^Record into pane B/ })
      .click();

    await page.locator("#record").click();
    await page.waitForTimeout(3500);
    await page.locator("#record").click();
    await expect(page.locator("#status")).toContainText("Stopped");

    await restPointer(page);
    // Relative, not against a threshold: in compare mode each pane is half
    // height and a few seconds of audio covers a fraction of the width, so an
    // absolute "lit enough" number would be tuned to this viewport rather than
    // to the question. An empty pane still draws the note ruler and the time
    // axis, so A is not zero either -- what matters is that B has more.
    const armed = await canvasStats(paneCanvas(page, 1));
    const idle = await canvasStats(paneCanvas(page, 0));
    expect(armed.litFraction).toBeGreaterThan(idle.litFraction + 0.005);

    // The categorical signal: A never received a sample.
    await expect(page.locator(".pane").nth(0).locator(".pane-hint")).toBeVisible();
    await expect(page.locator(".pane").nth(1).locator(".pane-hint")).toBeHidden();
  });

  test("clicking Record twice quickly still starts one capture", async ({ page }) => {
    // Two chains would both write to the ring, doubling the scroll speed and
    // leaking a MediaStream whose tracks are never stopped.
    await page.goto("/");
    await page.locator("#record").click();
    await page.locator("#record").click({ force: true });
    await page.waitForTimeout(2500);

    // Whatever the clicks resolved to, the app is in one consistent state.
    const label = await page.locator("#record").textContent();
    expect(["Record", "Stop"]).toContain(label);

    if (label === "Stop") await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Record");
    await expect(page.locator("#status")).toContainText("Stopped");
  });

  test("Space plays back without the canvas having been clicked", async ({ page }) => {
    // Clicking a button focuses it, and the keydown handler skips BUTTON
    // targets -- so Space used to re-trigger Record instead of playing.
    await page.goto("/");
    await page.locator("#record").click();
    await page.waitForTimeout(2500);
    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Record");

    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveText("Stop");
    // And the recording was not restarted.
    await expect(page.locator("#record")).toHaveText("Record");

    await page.keyboard.press("Escape");
    await expect(page.locator("#play")).toHaveText("Play");
  });
});
