export const COLORMAP_NAMES = ["magma", "viridis", "gray"] as const;
export type ColormapName = (typeof COLORMAP_NAMES)[number];

/**
 * 17 evenly spaced control stops per map, sampled from matplotlib's magma and
 * viridis at t = 0, 1/16, ... 1, and interpolated to 256 entries.
 *
 * Both are perceptually uniform: luminance rises monotonically, so a step in
 * dB reads as the same step in brightness anywhere in the range. That is the
 * property that makes the waterfall readable as an intensity map rather than
 * a decorative one. Storing stops instead of the full 256x3 table keeps this
 * file legible at negligible visual cost.
 */
const STOPS: Record<Exclude<ColormapName, "gray">, ReadonlyArray<readonly [number, number, number]>> = {
  magma: [
    [0, 0, 4],
    [8, 7, 30],
    [23, 15, 61],
    [43, 18, 96],
    [67, 15, 117],
    [88, 21, 125],
    [108, 28, 129],
    [128, 37, 130],
    [149, 44, 126],
    [170, 51, 119],
    [192, 58, 108],
    [212, 69, 95],
    [230, 87, 82],
    [243, 111, 76],
    [251, 139, 84],
    [254, 173, 106],
    [252, 253, 191],
  ],
  viridis: [
    [68, 1, 84],
    [71, 24, 106],
    [72, 44, 125],
    [69, 62, 134],
    [63, 79, 138],
    [56, 95, 140],
    [50, 110, 141],
    [45, 125, 142],
    [40, 139, 141],
    [36, 154, 138],
    [35, 168, 132],
    [45, 182, 122],
    [70, 195, 107],
    [104, 206, 88],
    [145, 214, 68],
    [190, 220, 57],
    [253, 231, 37],
  ],
};

/** 256 RGBA entries (1024 bytes), alpha fixed at 255. */
export function buildColormap(name: ColormapName): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);

  if (name === "gray") {
    for (let i = 0; i < 256; i++) {
      lut[i * 4] = i;
      lut[i * 4 + 1] = i;
      lut[i * 4 + 2] = i;
      lut[i * 4 + 3] = 255;
    }
    return lut;
  }

  const stops = STOPS[name];
  if (!stops) throw new RangeError(`unknown colormap ${name}`);

  const last = stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * last;
    const lo = Math.min(last, Math.floor(t));
    const hi = Math.min(last, lo + 1);
    const f = t - lo;
    for (let c = 0; c < 3; c++) {
      lut[i * 4 + c] = Math.round(stops[lo][c] + (stops[hi][c] - stops[lo][c]) * f);
    }
    lut[i * 4 + 3] = 255;
  }
  return lut;
}
