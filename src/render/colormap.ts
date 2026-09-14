import { COLORMAP_NAMES, type ColormapName } from "../config";

export { COLORMAP_NAMES, type ColormapName };

/**
 * 17 evenly spaced control stops per map, interpolated to 256 entries.
 *
 * magma and viridis come from matplotlib and are perceptually uniform:
 * luminance rises monotonically, so a step in dB reads as the same step in
 * brightness anywhere in the range. That is the property that makes the
 * waterfall readable as an intensity map rather than a decorative one, and it
 * is what config.ts PERCEPTUAL_COLORMAPS names and colormap.test.ts checks.
 *
 * turbo is the deliberate exception -- see its comment below. Storing stops
 * instead of the full 256x3 table keeps this file legible at negligible
 * visual cost.
 */
const STOPS: Record<
  Exclude<ColormapName, "gray">,
  ReadonlyArray<readonly [number, number, number]>
> = {
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
  /**
   * Google's Turbo (Mikhailov 2019, Apache-2.0), sampled from the published
   * 256-entry table at the 17 stops this file uses. The endpoints match the
   * documented #30123b and #7a0403, which is the check that the right table
   * was transcribed.
   *
   * A rainbow, and chosen for that: a partial separates from the noise floor
   * by hue as well as by brightness, so formants and onsets are easier to spot
   * at a glance than under magma. Turbo is the version of that idea worth
   * having -- it was built to fix jet's false banding, and its gradient is
   * smooth rather than full of edges the data does not contain.
   *
   * It is still not perceptually uniform, and for a spectrogram one
   * consequence matters more than the rest. Luminance runs 27 at the dark blue
   * floor, up to 220 at the yellow-green middle, back down to 29 at the dark
   * red top. The quietest and the loudest bins therefore have almost the same
   * brightness and are told apart only by hue -- which also means they are
   * ambiguous in greyscale, in print, and to achromatopsia. Use it to find
   * things; switch to magma to judge how loud they are.
   */
  turbo: [
    [48, 18, 59],
    [64, 64, 162],
    [70, 107, 227],
    [66, 148, 255],
    [40, 188, 235],
    [24, 221, 194],
    [50, 242, 152],
    [113, 254, 95],
    [167, 252, 58],
    [203, 237, 52],
    [231, 215, 57],
    [250, 186, 57],
    [252, 135, 37],
    [237, 85, 16],
    [210, 49, 5],
    [175, 24, 1],
    [122, 4, 3],
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
