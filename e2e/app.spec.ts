import { expect, test } from "@playwright/test";

test("the app boots and shows its controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  await expect(page.locator("#record")).toHaveText("Record");
  await expect(page.locator("#compare")).toHaveText("Compare");
  await expect(page.locator(".pane").first()).toBeVisible();
  // Pane B exists but is not shown until Compare.
  await expect(page.locator(".pane").nth(1)).toBeHidden();

  expect(errors).toEqual([]);
});

test("the second pane is hidden but its audio survives the toggle", async ({ page }) => {
  await page.goto("/");
  const panes = page.locator(".pane");

  await page.locator("#compare").click();
  await expect(panes.nth(1)).toBeVisible();
  await expect(page.locator("#compare")).toHaveText("Single");

  await page.locator("#compare").click();
  await expect(panes.nth(1)).toBeHidden();
  await expect(page.locator("#compare")).toHaveText("Compare");
});

test("the split setting changes the layout and survives a reload", async ({ page }) => {
  await page.goto("/");
  const panes = page.locator("#panes");
  await expect(panes).toHaveAttribute("data-layout", "stacked");

  await page.getByLabel("Split").selectOption("columns");
  await expect(panes).toHaveAttribute("data-layout", "columns");

  await page.reload();
  await expect(page.locator("#panes")).toHaveAttribute("data-layout", "columns");
});

test("boots on default settings when storage is unavailable", async ({ page }) => {
  // Safari with site data blocked throws on *reading* the localStorage
  // identifier. That took the whole app down at boot once, because the guard
  // was a default parameter value, which is evaluated outside the try around it.
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("SecurityError: storage is blocked");
      },
    });
  });

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.locator("#record")).toHaveText("Record");
  expect(errors).toEqual([]);
});
