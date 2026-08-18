import { BIN_COUNT, F_MAX, F_MIN } from "../config";

/**
 * Position of a frequency on the stored log grid, as a fractional bin index.
 *
 * The grid's *geometry* depends only on (fMin, fMax, binCount); reducing an
 * FFT spectrum onto it additionally needs (fftSize, sampleRate). These two
 * functions are the geometry half, kept free-standing so the render and UI
 * layers — which legitimately have no FFT parameters — can share the one
 * definition instead of restating it. Every stored Int8 in ColumnStore is
 * indexed on this mapping, so a second copy that drifts would silently
 * mis-register the note ruler against the spectrogram it labels.
 */
export function freqToBin(
  freq: number,
  fMin: number = F_MIN,
  fMax: number = F_MAX,
  binCount: number = BIN_COUNT,
): number {
  return ((Math.log(freq) - Math.log(fMin)) / (Math.log(fMax) - Math.log(fMin))) * (binCount - 1);
}

export function binToFreq(
  bin: number,
  fMin: number = F_MIN,
  fMax: number = F_MAX,
  binCount: number = BIN_COUNT,
): number {
  const logMin = Math.log(fMin);
  return Math.exp(logMin + ((Math.log(fMax) - logMin) * bin) / (binCount - 1));
}

/**
 * Maps a linear FFT magnitude spectrum onto a fixed logarithmic frequency
 * grid (DESIGN.md §4).
 *
 * The grid is the same for every window length, so switching window length
 * changes only the resolution of new columns, never their layout. Columns are
 * stored across the full F_MIN..F_MAX range regardless of the display limit;
 * the display limit crops, it never triggers a recompute.
 *
 * Two regimes meet here. Above roughly 1.5 kHz (at 4096/48 kHz) several FFT
 * bins fall inside one log bin, and the max is the right summary — it keeps
 * narrow peaks visible instead of averaging them away. Below that the log bins
 * are finer than the FFT grid and many contain no FFT bin at all; those are
 * interpolated in the dB domain from the neighbouring FFT bins, which keeps
 * the low end smooth rather than staircased.
 */
export class LogBinMap {
  readonly binCount: number;
  readonly fftSize: number;
  readonly sampleRate: number;
  readonly fMin: number;
  readonly fMax: number;

  /** Centre frequency of each log bin, Hz. */
  readonly centers: Float32Array;

  private readonly logMin: number;
  private readonly logSpan: number;
  private readonly fftBinCount: number;

  /** Inclusive FFT bin range per log bin; `lo > hi` marks an empty bin. */
  private readonly lo: Int32Array;
  private readonly hi: Int32Array;
  /** Fractional FFT position of each log bin centre, used when the range is empty. */
  private readonly fpos: Float32Array;

  constructor(
    fftSize: number,
    sampleRate: number,
    binCount: number = BIN_COUNT,
    fMin: number = F_MIN,
    fMax: number = F_MAX,
  ) {
    this.fftSize = fftSize;
    this.sampleRate = sampleRate;
    this.binCount = binCount;
    this.fMin = fMin;
    this.fMax = fMax;
    this.fftBinCount = fftSize / 2 + 1;

    this.logMin = Math.log(fMin);
    this.logSpan = Math.log(fMax) - this.logMin;

    this.centers = new Float32Array(binCount);
    for (let i = 0; i < binCount; i++) {
      this.centers[i] = Math.exp(this.logMin + (this.logSpan * i) / (binCount - 1));
    }

    this.lo = new Int32Array(binCount);
    this.hi = new Int32Array(binCount);
    this.fpos = new Float32Array(binCount);

    const hzPerBin = sampleRate / fftSize;
    // Geometric midpoints between neighbouring centres, extended at both ends.
    const ratio = Math.exp(this.logSpan / (binCount - 1));
    const halfStep = Math.sqrt(ratio);
    for (let i = 0; i < binCount; i++) {
      const center = this.centers[i];
      const edgeLo = center / halfStep;
      const edgeHi = center * halfStep;
      const first = Math.ceil(edgeLo / hzPerBin);
      const last = Math.floor(edgeHi / hzPerBin);
      this.lo[i] = Math.max(0, first);
      this.hi[i] = Math.min(this.fftBinCount - 1, last);
      this.fpos[i] = center / hzPerBin;
    }
  }

  /** Fractional log-bin position of a frequency. */
  freqToBin(freq: number): number {
    return freqToBin(freq, this.fMin, this.fMax, this.binCount);
  }

  /** Frequency at a fractional log-bin position, Hz. */
  binToFreq(bin: number): number {
    return binToFreq(bin, this.fMin, this.fMax, this.binCount);
  }

  /** Reduces `magDb` (dBFS per FFT bin) to `out` (dBFS per log bin, clamped to Int8). */
  apply(magDb: Float32Array, out: Int8Array): void {
    if (magDb.length !== this.fftBinCount) {
      throw new RangeError(`magDb must be ${this.fftBinCount} bins, got ${magDb.length}`);
    }
    if (out.length !== this.binCount) {
      throw new RangeError(`out must be ${this.binCount} bins, got ${out.length}`);
    }

    const last = this.fftBinCount - 1;
    for (let i = 0; i < this.binCount; i++) {
      const lo = this.lo[i];
      const hi = this.hi[i];
      let value: number;

      if (lo <= hi) {
        value = magDb[lo];
        for (let k = lo + 1; k <= hi; k++) if (magDb[k] > value) value = magDb[k];
      } else {
        const p = this.fpos[i];
        const a = Math.min(last, Math.max(0, Math.floor(p)));
        const b = Math.min(last, a + 1);
        value = magDb[a] + (magDb[b] - magDb[a]) * (p - a);
      }

      const v = Math.round(value);
      out[i] = v > 0 ? 0 : v < -127 ? -127 : v;
    }
  }
}
