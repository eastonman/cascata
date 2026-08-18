import { FFT } from "./fft";
import { hann, windowSum } from "./window";

/** Magnitude floor before the log, i.e. -200 dBFS. */
const MAG_FLOOR = 1e-10;

/**
 * Windowed magnitude spectrum in dBFS.
 *
 * Normalisation is by the window's coherent gain, so a full-scale sine sitting
 * on a bin centre reads ~0 dBFS (DESIGN.md §5.1). All scratch buffers are
 * owned by the instance; `compute` allocates nothing.
 */
export class Spectrum {
  readonly fftSize: number;
  readonly binCount: number;

  private readonly fft: FFT;
  private readonly window: Float32Array;
  private readonly scale: number;
  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(fftSize: number) {
    this.fftSize = fftSize;
    this.binCount = fftSize / 2 + 1;
    this.fft = new FFT(fftSize);
    this.window = hann(fftSize);
    this.scale = 2 / windowSum(this.window);
    this.re = new Float32Array(fftSize);
    this.im = new Float32Array(fftSize);
  }

  /** Centre frequency of an FFT bin, Hz. */
  binFreq(bin: number, sampleRate: number): number {
    return (bin * sampleRate) / this.fftSize;
  }

  /** Writes `binCount` dBFS values into `out`. `frame` must be `fftSize` long. */
  compute(frame: Float32Array, out: Float32Array): void {
    if (frame.length !== this.fftSize) {
      throw new RangeError(`frame must be ${this.fftSize} samples, got ${frame.length}`);
    }
    if (out.length !== this.binCount) {
      throw new RangeError(`out must be ${this.binCount} bins, got ${out.length}`);
    }

    const { re, im, window } = this;
    for (let i = 0; i < this.fftSize; i++) {
      re[i] = frame[i] * window[i];
      im[i] = 0;
    }
    this.fft.forward(re, im);

    for (let k = 0; k < this.binCount; k++) {
      const mag = Math.hypot(re[k], im[k]) * this.scale;
      out[k] = 20 * Math.log10(mag > MAG_FLOOR ? mag : MAG_FLOOR);
    }
  }
}
