import { BIN_COUNT, DEFAULT_FFT_SIZE, FFT_SIZES, HOP, type FftSize } from "../config";
import { LogBinMap } from "../dsp/logBins";
import { Spectrum } from "../dsp/spectrum";
import { Yin } from "../dsp/yin";
import { ColumnStore, F0_UNCOMPUTED } from "../store/columnStore";
import { PcmRing } from "../store/pcmRing";

export interface AnalyzerOptions {
  sampleRate: number;
  pcm: PcmRing;
  columns: ColumnStore;
}

interface Kernel {
  spectrum: Spectrum;
  map: LogBinMap;
  frame: Float32Array;
  magDb: Float32Array;
}

const DEFAULT_MAX_COLUMNS = 256;

/**
 * Derives spectrum columns and fundamental frequencies from recorded PCM.
 *
 * The time grid is fixed and window-length independent: column c is *centred*
 * on sample c * HOP, so its STFT frame spans
 * [c*HOP - fftSize/2, c*HOP + fftSize/2). Changing the window length therefore
 * changes the resolution of new columns but never moves an existing column in
 * time (DESIGN.md §4). The cost is a fftSize/2 lookahead — the 42.7 ms
 * window-centre lag in the §5.4 latency budget.
 *
 * There is exactly one cursor and it only moves forward. Live capture and
 * scrub-back read the same columns, which is what makes what you see live and
 * what you see on playback identical.
 */
export class Analyzer {
  readonly sampleRate: number;

  private readonly pcm: PcmRing;
  private readonly columns: ColumnStore;
  private readonly kernels = new Map<FftSize, Kernel>();
  private readonly yin: Yin;
  private readonly yinFrame: Float32Array;
  private readonly outColumn: Int8Array;

  private size: FftSize = DEFAULT_FFT_SIZE;
  private pitch = true;
  private cursorCol = 0;

  constructor(opts: AnalyzerOptions) {
    this.sampleRate = opts.sampleRate;
    this.pcm = opts.pcm;
    this.columns = opts.columns;
    this.yin = new Yin({ sampleRate: opts.sampleRate });
    this.yinFrame = new Float32Array(this.yin.requiredSamples);
    this.outColumn = new Int8Array(BIN_COUNT);
  }

  /** Absolute index of the next column to be produced. */
  get cursor(): number {
    return this.cursorCol;
  }

  get fftSize(): FftSize {
    return this.size;
  }

  get pitchEnabled(): boolean {
    return this.pitch;
  }

  setFftSize(size: FftSize): void {
    if (!FFT_SIZES.includes(size)) {
      throw new RangeError(`unsupported FFT size ${size}`);
    }
    this.size = size;
  }

  setPitchEnabled(on: boolean): void {
    this.pitch = on;
  }

  reset(): void {
    this.cursorCol = 0;
  }

  /**
   * Produces every column whose source samples have arrived, up to
   * `maxColumns`. Returns the number produced.
   */
  pump(maxColumns: number = DEFAULT_MAX_COLUMNS): number {
    const kernel = this.kernel();
    const halfWindow = this.size / 2;
    // YIN reads from -windowSize/2 forward across the longest period searched.
    const yinLead = this.yin.windowSize / 2 + this.yin.tauMax;
    const lookahead = Math.max(halfWindow, yinLead);

    let produced = 0;
    while (produced < maxColumns) {
      const center = this.cursorCol * HOP;
      if (this.pcm.writeIndex < center + lookahead) break;

      this.pcm.read(center - halfWindow, kernel.frame);
      kernel.spectrum.compute(kernel.frame, kernel.magDb);
      kernel.map.apply(kernel.magDb, this.outColumn);

      let f0 = F0_UNCOMPUTED;
      if (this.pitch) {
        this.pcm.read(center - this.yin.windowSize / 2, this.yinFrame);
        f0 = this.yin.detect(this.yinFrame);
      }

      this.columns.push(this.outColumn, f0);
      this.cursorCol++;
      produced++;
    }
    return produced;
  }

  private kernel(): Kernel {
    let k = this.kernels.get(this.size);
    if (!k) {
      const spectrum = new Spectrum(this.size);
      k = {
        spectrum,
        map: new LogBinMap(this.size, this.sampleRate),
        frame: new Float32Array(this.size),
        magDb: new Float32Array(spectrum.binCount),
      };
      this.kernels.set(this.size, k);
    }
    return k;
  }
}
