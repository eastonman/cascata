import { YIN_FMAX, YIN_FMIN, YIN_SILENCE_DB, YIN_THRESHOLD, YIN_WINDOW } from "../config";

export interface YinOptions {
  sampleRate: number;
  windowSize?: number;
  fMin?: number;
  fMax?: number;
  threshold?: number;
  silenceDb?: number;
}

/**
 * YIN fundamental frequency estimator (de Cheveigne & Kawahara 2002).
 *
 * Steps 1-5 of the paper: difference function, cumulative mean normalisation,
 * absolute threshold, and parabolic interpolation. Step 6 (best local
 * estimate) is deliberately omitted — it smooths across frames, and DESIGN.md
 * §5.2 wants vibrato rate and depth preserved and octave errors visible rather
 * than hidden.
 *
 * Returns 0 for silence, aperiodic input, or a result outside [fMin, fMax].
 * Callers distinguish that from "not computed", which they store as -1.
 */
export class Yin {
  readonly sampleRate: number;
  readonly windowSize: number;
  readonly fMin: number;
  readonly fMax: number;
  readonly threshold: number;
  readonly silenceDb: number;
  readonly tauMin: number;
  readonly tauMax: number;
  /** Samples `detect` needs: the analysis window plus the longest period searched. */
  readonly requiredSamples: number;

  private readonly diff: Float32Array;
  private readonly cmnd: Float32Array;

  constructor(opts: YinOptions) {
    this.sampleRate = opts.sampleRate;
    this.windowSize = opts.windowSize ?? YIN_WINDOW;
    this.fMin = opts.fMin ?? YIN_FMIN;
    this.fMax = opts.fMax ?? YIN_FMAX;
    this.threshold = opts.threshold ?? YIN_THRESHOLD;
    this.silenceDb = opts.silenceDb ?? YIN_SILENCE_DB;

    this.tauMin = Math.max(2, Math.ceil(this.sampleRate / this.fMax));
    // ceil + 1, not floor: at exactly fMin the true period is fractional, so
    // floor(sr/fMin) would put the CMND minimum one sample outside the search
    // range and leave no room for parabolic interpolation at the last index.
    this.tauMax = Math.ceil(this.sampleRate / this.fMin) + 1;
    this.requiredSamples = this.windowSize + this.tauMax;

    this.diff = new Float32Array(this.tauMax + 1);
    this.cmnd = new Float32Array(this.tauMax + 1);
  }

  detect(buf: Float32Array): number {
    if (buf.length < this.requiredSamples) {
      throw new RangeError(`Yin.detect needs ${this.requiredSamples} samples, got ${buf.length}`);
    }

    const W = this.windowSize;

    let energy = 0;
    for (let i = 0; i < W; i++) energy += buf[i] * buf[i];
    const rms = Math.sqrt(energy / W);
    if (rms <= 0 || 20 * Math.log10(rms) < this.silenceDb) return 0;

    const { diff, cmnd } = this;
    diff[0] = 0;
    for (let tau = 1; tau <= this.tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const d = buf[j] - buf[j + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= this.tauMax; tau++) {
      running += diff[tau];
      cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
    }

    // First dip below the threshold, followed down to its local minimum.
    let tau = -1;
    for (let t = this.tauMin; t < this.tauMax; t++) {
      if (cmnd[t] < this.threshold) {
        while (t + 1 < this.tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return 0;

    const refined = this.parabolic(tau);
    if (refined <= 0) return 0;
    const freq = this.sampleRate / refined;
    return freq >= this.fMin && freq <= this.fMax ? freq : 0;
  }

  /** Sub-sample minimum of the CMND curve around `tau`. */
  private parabolic(tau: number): number {
    const { cmnd } = this;
    if (tau <= 0 || tau >= this.tauMax) return tau;
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom === 0) return tau;
    return tau + (c - a) / denom;
  }
}
