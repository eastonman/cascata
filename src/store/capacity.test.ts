import { expect, test } from "bun:test";
import { BIN_COUNT, HOP } from "../config";
import { planImportCapacity, storeBytesPerSecond } from "./capacity";

const GIB = 1024 ** 3;

test("storeBytesPerSecond counts PCM, columns, and f0", () => {
  // 48 kHz: 96000 B PCM + 46.875 col/s * 600 B + 46.875 col/s * 4 B
  expect(storeBytesPerSecond(48000)).toBeCloseTo(96000 + 28125 + 187.5, 6);
  // 44.1 kHz, computed the same way rather than restating a magic number.
  const colsPerSec = 44100 / HOP;
  expect(storeBytesPerSecond(44100)).toBeCloseTo(
    44100 * 2 + colsPerSec * BIN_COUNT + colsPerSec * 4,
    6,
  );
});

test("a file that fits is not truncated", () => {
  const plan = planImportCapacity(180, 48000, GIB);
  expect(plan.truncated).toBe(false);
  expect(plan.seconds).toBe(180);
  expect(plan.bytes).toBeLessThan(GIB);
  // 3 minutes is about 22 MB of stores.
  expect(plan.bytes / 1024 ** 2).toBeGreaterThan(20);
  expect(plan.bytes / 1024 ** 2).toBeLessThan(24);
});

test("a file over the cap is truncated and stays inside the budget", () => {
  const plan = planImportCapacity(10 * 3600, 48000, GIB);
  expect(plan.truncated).toBe(true);
  expect(plan.bytes).toBeLessThanOrEqual(GIB);
  // 1 GiB holds roughly 144 minutes at 48 kHz.
  expect(plan.seconds / 60).toBeGreaterThan(140);
  expect(plan.seconds / 60).toBeLessThan(146);
});

test("the cap in seconds follows the sample rate", () => {
  const at48 = planImportCapacity(10 * 3600, 48000, GIB);
  const at44 = planImportCapacity(10 * 3600, 44100, GIB);
  // A lower rate costs fewer bytes per second, so more of it fits.
  expect(at44.seconds).toBeGreaterThan(at48.seconds);
  expect(at44.bytes).toBeLessThanOrEqual(GIB);
});

test("planning is idempotent: re-planning a truncated result changes nothing", () => {
  // The rate-based maximum is not a valid duration, because rounding sample
  // and column counts up pushes it back over the budget. What must hold is
  // that whatever the planner does settle on is itself a duration that fits.
  const truncated = planImportCapacity(10 * 3600, 48000, GIB);
  expect(truncated.truncated).toBe(true);

  const again = planImportCapacity(truncated.seconds, 48000, GIB);
  expect(again.truncated).toBe(false);
  expect(again.seconds).toBe(truncated.seconds);
  expect(again.bytes).toBe(truncated.bytes);
  expect(again.bytes).toBeLessThanOrEqual(GIB);
});

test("the planned duration is a whole number of hops", () => {
  const plan = planImportCapacity(10 * 3600, 48000, GIB);
  expect(((plan.seconds * 48000) / HOP) % 1).toBeCloseTo(0, 9);
});

test("empty and negative durations plan nothing rather than throwing", () => {
  for (const d of [0, -1, Number.NaN]) {
    const plan = planImportCapacity(d, 48000, GIB);
    expect(plan.seconds).toBe(0);
    expect(plan.bytes).toBe(0);
    expect(plan.truncated).toBe(false);
  }
});

test("bytes reflect the allocation actually made, not a rate estimate", () => {
  const sr = 48000;
  const plan = planImportCapacity(10, sr, GIB);
  const samples = Math.ceil(plan.seconds * sr);
  const cols = Math.ceil(samples / HOP);
  expect(plan.bytes).toBe(samples * 2 + cols * BIN_COUNT + cols * 4);
});

test("a budget too small for even one column still plans nothing", () => {
  const plan = planImportCapacity(60, 48000, 10);
  expect(plan.seconds).toBe(0);
  expect(plan.truncated).toBe(true);
});
