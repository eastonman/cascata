/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 *
 * Bit-reversal permutation and twiddle factors are precomputed once per size,
 * so `forward` allocates nothing. At hop 1024 / 48 kHz this runs ~47 times a
 * second on a 4096-point frame, which is far below any performance concern;
 * clarity is worth more here than a split-radix variant.
 */
export class FFT {
  readonly size: number;
  private readonly levels: number;
  private readonly reverse: Uint32Array;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new RangeError(`FFT size must be a power of two >= 2, got ${size}`);
    }
    this.size = size;
    this.levels = Math.log2(size);

    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < this.levels; b++) r |= ((i >>> b) & 1) << (this.levels - 1 - b);
      this.reverse[i] = r;
    }

    const half = size / 2;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }
  }

  /** Transforms `re`/`im` in place. Both must have length `size`. */
  forward(re: Float32Array, im: Float32Array): void {
    const n = this.size;
    if (re.length !== n || im.length !== n) {
      throw new RangeError(`FFT expects arrays of length ${n}`);
    }

    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }

    for (let span = 2; span <= n; span *= 2) {
      const half = span / 2;
      const stride = n / span;
      for (let start = 0; start < n; start += span) {
        for (let k = 0, tw = 0; k < half; k++, tw += stride) {
          const c = this.cosTable[tw];
          const s = this.sinTable[tw];
          const a = start + k;
          const b = a + half;
          // Negative sine: forward transform uses e^{-i*2*pi*k/N}.
          const tre = re[b] * c + im[b] * s;
          const tim = -re[b] * s + im[b] * c;
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
  }
}
