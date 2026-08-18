import { expect, test } from "bun:test";
import { buildColormap, COLORMAP_NAMES } from "./colormap";

test("every colormap has 256 opaque RGBA entries", () => {
  for (const name of COLORMAP_NAMES) {
    const lut = buildColormap(name);
    expect(lut.length).toBe(256 * 4);
    for (let i = 0; i < 256; i++) expect(lut[i * 4 + 3]).toBe(255);
  }
});

test("perceptual maps increase monotonically in luminance", () => {
  // Each channel is rounded to 8 bits, so an entry's luminance carries up to
  // 0.5 * (0.2126 + 0.7152 + 0.0722) = 0.5 of quantisation error, and the
  // difference between neighbours up to 1.0. Anything beyond that is a real
  // non-monotonic stop, which would show up as a false contour in the
  // waterfall.
  const QUANTISATION_SLACK = 1.0;
  for (const name of ["magma", "viridis"] as const) {
    const lut = buildColormap(name);
    const lum = (i: number) =>
      0.2126 * lut[i * 4] + 0.7152 * lut[i * 4 + 1] + 0.0722 * lut[i * 4 + 2];
    for (let i = 1; i < 256; i++) {
      expect(lum(i)).toBeGreaterThanOrEqual(lum(i - 1) - QUANTISATION_SLACK);
    }
    expect(lum(255) - lum(0)).toBeGreaterThan(150);
  }
});

test("perceptual map control stops are strictly monotonic in luminance", () => {
  // The quantisation slack above would hide a genuinely flat or reversed
  // stop, so check the trend over 16-entry spans where rounding cannot mask it.
  for (const name of ["magma", "viridis"] as const) {
    const lut = buildColormap(name);
    const lum = (i: number) =>
      0.2126 * lut[i * 4] + 0.7152 * lut[i * 4 + 1] + 0.0722 * lut[i * 4 + 2];
    for (let i = 16; i < 256; i += 16) {
      expect(lum(i)).toBeGreaterThan(lum(i - 16));
    }
  }
});

test("gray is a linear ramp", () => {
  const lut = buildColormap("gray");
  expect(Array.from(lut.slice(0, 3))).toEqual([0, 0, 0]);
  expect(Array.from(lut.slice(255 * 4, 255 * 4 + 3))).toEqual([255, 255, 255]);
  expect(lut[128 * 4]).toBe(128);
});

test("magma starts near black and ends near white", () => {
  const lut = buildColormap("magma");
  expect(lut[0]).toBeLessThan(10);
  expect(lut[255 * 4]).toBeGreaterThan(240);
});

test("viridis starts dark blue-purple and ends yellow", () => {
  const lut = buildColormap("viridis");
  expect(lut[2]).toBeGreaterThan(lut[0]); // blue above red at the low end
  expect(lut[255 * 4]).toBeGreaterThan(200); // red high at the top
  expect(lut[255 * 4 + 1]).toBeGreaterThan(200); // green high at the top
  expect(lut[255 * 4 + 2]).toBeLessThan(100); // blue low at the top
});

test("buildColormap rejects unknown names", () => {
  // @ts-expect-error deliberately passing an unknown colormap
  expect(() => buildColormap("chartreuse")).toThrow();
});
