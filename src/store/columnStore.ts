/** f0 sentinel: the column was analysed and found silent or aperiodic. */
export const F0_SILENT = 0;
/** f0 sentinel: the column was never analysed (pitch overlay was off). */
export const F0_UNCOMPUTED = -1;

/**
 * Ring of spectrum columns and their fundamental frequencies, sharing the
 * absolute-index scheme of PcmRing (DESIGN.md §4).
 *
 * This is derived data: everything here can be recomputed from the PCM, so it
 * is safe to drop on a parameter change. Storing dB as Int8 costs 13.5 MB for
 * the full 8 minutes; 1 dB of quantisation is well under what the colormap can
 * show.
 */
export class ColumnStore {
  readonly capacityCols: number;
  readonly binCount: number;

  private readonly bins: Int8Array;
  private readonly f0: Float32Array;
  private written = 0;

  constructor(capacityCols: number, binCount: number) {
    if (!Number.isInteger(capacityCols) || capacityCols <= 0) {
      throw new RangeError(`capacityCols must be a positive integer, got ${capacityCols}`);
    }
    if (!Number.isInteger(binCount) || binCount <= 0) {
      throw new RangeError(`binCount must be a positive integer, got ${binCount}`);
    }
    this.capacityCols = capacityCols;
    this.binCount = binCount;
    this.bins = new Int8Array(capacityCols * binCount);
    this.f0 = new Float32Array(capacityCols);
  }

  /** Absolute count of columns ever pushed. Never resets. */
  get writeIndex(): number {
    return this.written;
  }

  /** Lowest absolute column index still retained. */
  get earliestIndex(): number {
    return Math.max(0, this.written - this.capacityCols);
  }

  has(col: number): boolean {
    return col >= this.earliestIndex && col < this.written;
  }

  push(db: Int8Array, f0: number): void {
    if (db.length !== this.binCount) {
      throw new RangeError(`column must have ${this.binCount} bins, got ${db.length}`);
    }
    const slot = this.written % this.capacityCols;
    this.bins.set(db, slot * this.binCount);
    this.f0[slot] = f0;
    this.written++;
  }

  readColumn(col: number, out: Int8Array): boolean {
    if (!this.has(col)) return false;
    if (out.length !== this.binCount) {
      throw new RangeError(`out must have ${this.binCount} bins, got ${out.length}`);
    }
    const offset = (col % this.capacityCols) * this.binCount;
    out.set(this.bins.subarray(offset, offset + this.binCount));
    return true;
  }

  /** Zero-copy view of a stored column. Valid only until that slot is overwritten. */
  columnView(col: number): Int8Array | null {
    if (!this.has(col)) return null;
    const offset = (col % this.capacityCols) * this.binCount;
    return this.bins.subarray(offset, offset + this.binCount);
  }

  getF0(col: number): number {
    if (!this.has(col)) return F0_UNCOMPUTED;
    return this.f0[col % this.capacityCols];
  }

  setF0(col: number, value: number): void {
    if (!this.has(col)) return;
    this.f0[col % this.capacityCols] = value;
  }

  clear(): void {
    this.bins.fill(0);
    this.f0.fill(F0_UNCOMPUTED);
    this.written = 0;
  }
}
