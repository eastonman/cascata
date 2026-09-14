#!/usr/bin/env bun
/**
 * Launches one browser and opens a blank page, then exits.
 *
 * A browser that cannot start does not say so: Playwright reports
 * `newPage: Test timeout exceeded` on every test instead, which on CI meant
 * ten minutes of identical 35-second failures and a log that never named the
 * cause. This does what the first test would, and fails fast.
 *
 * The deadline covers the whole attempt, not just launch(). An earlier version
 * passed a timeout to launch() alone and then hung for sixteen minutes inside
 * newPage(), which is the same unhelpful silence it exists to prevent.
 */
import { chromium, webkit } from "@playwright/test";

const LIMIT_MS = 60_000;
const engines = { chromium, webkit } as const;
const name = process.argv[2];

if (!(name in engines)) {
  console.error(`usage: check-browser.ts <${Object.keys(engines).join("|")}>`);
  process.exit(2);
}

const giveUp = setTimeout(() => {
  console.error(`FAIL  ${name} did not start within ${LIMIT_MS / 1000}s`);
  process.exit(1);
}, LIMIT_MS);

console.log(
  `PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? "(unset, using Playwright's own)"}`,
);

try {
  const browser = await engines[name as keyof typeof engines].launch({ timeout: LIMIT_MS / 2 });
  const page = await browser.newPage();
  await page.setContent("<title>preflight</title>", { timeout: LIMIT_MS / 4 });
  const title = await page.title();
  await browser.close();
  if (title !== "preflight") throw new Error(`unexpected title ${title}`);
  clearTimeout(giveUp);
  console.log(`ok    ${name} launches and renders`);
  process.exit(0);
} catch (err) {
  clearTimeout(giveUp);
  console.error(`FAIL  ${name} could not start: ${(err as Error).message}`);
  process.exit(1);
}
