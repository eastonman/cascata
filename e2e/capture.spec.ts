import { type Page, expect, test } from "@playwright/test";
import { canvasStats, paneCanvas, restPointer } from "./helpers";

/**
 * The "mm:ss.d buffered" the status bar reports for the active pane, in seconds.
 *
 * Waits for it first: a transient message such as "Stopped" deliberately holds
 * the bar for a couple of seconds so it can be read, and during that hold the
 * state line is not written at all.
 */
async function bufferedSeconds(page: Page): Promise<number> {
  await expect(page.locator("#status")).toContainText("buffered", { timeout: 5000 });
  const text = (await page.locator("#status").textContent()) ?? "";
  const match = text.match(/(\d+):(\d+\.\d)\s+buffered/);
  if (!match) throw new Error(`no buffered time in status: ${text}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// Chromium only. The fake capture device comes from --use-file-for-fake-audio-capture,
// which WebKit has no equivalent for, so the capture path cannot be driven
// there. Everything else in the suite runs on both.
//
// It is not only the device. Under Playwright's headless WebKit the app never
// gets past `await audioContext.resume()`: the context stays suspended, the
// promise never settles, and pressing Record leaves the status bar untouched.
// Nothing after that line is reachable, which is why even the tests here that
// need no audio at all still live inside this block.
test.describe("capture", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "needs a fake audio device");

  /**
   * Refusing the microphone, driven by replacing getUserMedia rather than by
   * the browser's permission UI: with --use-fake-ui-for-media-stream Chromium
   * never shows that UI, and what is under test is how the app handles a
   * rejected promise, not how the browser decides to reject one.
   */
  test("refusing the microphone leaves the app usable", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await page.goto("/");

    await page.locator("#record").click();
    await expect(page.locator("#status")).toContainText("Could not start capture");
    await expect(page.locator("#status")).toContainText("Permission denied");

    // Not stuck mid-recording: the button is back to its resting label and the
    // controls that need audio are still off.
    await expect(page.locator("#record")).toHaveText("Record");
    await expect(page.locator("#play")).toBeDisabled();
    await expect(page.locator("#export")).toBeDisabled();

    // And it can be asked again rather than needing a reload.
    await page.locator("#record").click();
    await expect(page.locator("#status")).toContainText("Could not start capture");
    await expect(page.locator("#record")).toHaveText("Record");
  });

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

  test("recording again resumes the same buffer rather than starting over", async ({ page }) => {
    await page.goto("/");
    await page.locator("#record").click();
    await page.waitForTimeout(2500);
    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Record");
    const first = await bufferedSeconds(page);
    expect(first).toBeGreaterThan(1);

    await page.locator("#record").click();
    await page.waitForTimeout(2500);
    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Record");
    const second = await bufferedSeconds(page);

    // The time axis carries on: a second take adds to the buffer instead of
    // resetting it, so the total is close to both takes together.
    expect(second).toBeGreaterThan(first * 1.6);
  });

  test("recording continues while the view is pinned", async ({ page }) => {
    // Scrolling back to look at something must not cost you the take that is
    // still being sung.
    await page.goto("/");
    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Stop");
    await page.waitForTimeout(2000);

    await paneCanvas(page).click({ position: { x: 40, y: 40 } });
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#status")).toContainText("pinned");

    const pinned = await bufferedSeconds(page);
    await page.waitForTimeout(2000);
    await expect(page.locator("#status")).toContainText("pinned");
    expect(await bufferedSeconds(page)).toBeGreaterThan(pinned + 1);

    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Record");
  });

  test("a microphone that goes away mid-recording stops the UI too", async ({ page }) => {
    // Unplugging a USB mic, or another app preempting the device. Without this
    // the header would keep claiming "Recording" over a waterfall that stopped
    // moving several minutes ago.
    //
    // The event is dispatched rather than provoked: per spec, calling stop()
    // on a track deliberately does not fire "ended", so there is no way to
    // make a real device disappear from inside the page. The track is stopped
    // as well, so the stream really is dead and not just pretending.
    await page.addInitScript(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await real(constraints);
        (window as unknown as { captureStream?: MediaStream }).captureStream = stream;
        return stream;
      };
    });
    await page.goto("/");

    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveText("Stop");
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      const stream = (window as unknown as { captureStream?: MediaStream }).captureStream;
      if (!stream) throw new Error("capture stream was never captured");
      for (const track of stream.getTracks()) {
        track.stop();
        track.dispatchEvent(new Event("ended"));
      }
    });

    await expect(page.locator("#status")).toContainText("microphone became unavailable");
    await expect(page.locator("#record")).toHaveText("Record");

    // What was already captured is kept -- a device failure is not a reason to
    // throw away the take.
    await expect(page.locator("#play")).toBeEnabled();
    await expect(page.locator("#export")).toBeEnabled();
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
