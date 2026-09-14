import { expect, test } from "bun:test";
import { PERCEPTUAL_COLORMAPS } from "../config";
import { buildColormap, COLORMAP_NAMES } from "./colormap";

const luminanceOf = (lut: Uint8ClampedArray) => (i: number) =>
  0.2126 * lut[i * 4] + 0.7152 * lut[i * 4 + 1] + 0.0722 * lut[i * 4 + 2];

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
  for (const name of PERCEPTUAL_COLORMAPS) {
    const lut = buildColormap(name);
    const lum = luminanceOf(lut);
    for (let i = 1; i < 256; i++) {
      expect(lum(i)).toBeGreaterThanOrEqual(lum(i - 1) - QUANTISATION_SLACK);
    }
    expect(lum(255) - lum(0)).toBeGreaterThan(150);
  }
});

test("perceptual map control stops are strictly monotonic in luminance", () => {
  // The quantisation slack above would hide a genuinely flat or reversed
  // stop, so check the trend over 16-entry spans where rounding cannot mask it.
  for (const name of PERCEPTUAL_COLORMAPS) {
    const lut = buildColormap(name);
    const lum = luminanceOf(lut);
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

test("turbo matches the published table at both ends and runs through green", () => {
  const lut = buildColormap("turbo");
  const hex = (i: number) =>
    [lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("");

  // Google's documented endpoints. If a transcription of the 256-entry table
  // drifted, this is where it shows.
  expect(hex(0)).toBe("30123b");
  expect(hex(255)).toBe("7a0403");

  // Blue low, green through the middle, red high.
  const at = (i: number) => [lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]] as const;
  const [rLow, gLow, bLow] = at(30);
  expect(bLow).toBeGreaterThan(rLow);
  expect(bLow).toBeGreaterThan(gLow);

  const [rMid, gMid, bMid] = at(128);
  expect(gMid).toBeGreaterThan(200);
  expect(gMid).toBeGreaterThan(bMid * 2);
  expect(rMid).toBeLessThan(gMid);

  const [rTop, gTop, bTop] = at(240);
  expect(rTop).toBeGreaterThan(gTop * 3);
  expect(rTop).toBeGreaterThan(bTop * 3);
});

test("turbo is dark at both ends, which is the trade it makes", () => {
  // Luminance runs about 27 at the blue floor, 220 at the yellow-green middle,
  // and 29 at the red top. So the quietest and the loudest bins have nearly
  // the same brightness and differ only in hue -- ambiguous in greyscale, in
  // print, and to achromatopsia. Pinned rather than left to a comment: anyone
  // "fixing" this has changed what the colormap is.
  const lum = luminanceOf(buildColormap("turbo"));
  const all = Array.from({ length: 256 }, (_, i) => lum(i));
  const peak = Math.max(...all);

  expect(peak).toBeGreaterThan(200);
  expect(lum(0)).toBeLessThan(40);
  expect(lum(255)).toBeLessThan(40);
  expect(Math.abs(lum(255) - lum(0))).toBeLessThan(15);
  // The peak really is in the middle rather than at either end.
  expect(all.indexOf(peak)).toBeGreaterThan(100);
  expect(all.indexOf(peak)).toBeLessThan(180);
});

test("buildColormap rejects unknown names", () => {
  // @ts-expect-error deliberately passing an unknown colormap
  expect(() => buildColormap("chartreuse")).toThrow();
});
