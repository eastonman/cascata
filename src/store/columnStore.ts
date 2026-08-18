import { ringSlot, type AbsoluteRing } from "./ring";

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
export class ColumnStore implements AbsoluteRing {
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

  /**
   * Stores a column at its absolute grid index.
   *
   * The index is passed in rather than inferred from an internal counter: the
   * analyzer's cursor is the authority on which grid position a column belongs
   * to, and the two drifting apart would silently shift the whole time axis.
   * A forward gap is legal — the analyzer skips columns whose PCM has already
   * been evicted — and the skipped positions are filled with the dB floor and
   * "not computed", which is what they honestly are.
   */
  push(col: number, db: Int8Array, f0: number): void {
    if (db.length !== this.binCount) {
      throw new RangeError(`column must have ${this.binCount} bins, got ${db.length}`);
    }
    if (col < this.written) {
      throw new RangeError(`column ${col} was already written (writeIndex ${this.written})`);
    }

    const gap = col - this.written;
    if (gap >= this.capacityCols) {
      this.bins.fill(-127);
      this.f0.fill(F0_UNCOMPUTED);
    } else {
      for (let c = this.written; c < col; c++) {
        const s = ringSlot(c, this.capacityCols);
        this.bins.fill(-127, s * this.binCount, (s + 1) * this.binCount);
        this.f0[s] = F0_UNCOMPUTED;
      }
    }

    const slot = ringSlot(col, this.capacityCols);
    this.bins.set(db, slot * this.binCount);
    this.f0[slot] = f0;
    this.written = col + 1;
  }

  readColumn(col: number, out: Int8Array): boolean {
    if (!this.has(col)) return false;
    if (out.length !== this.binCount) {
      throw new RangeError(`out must have ${this.binCount} bins, got ${out.length}`);
    }
    const offset = ringSlot(col, this.capacityCols) * this.binCount;
    out.set(this.bins.subarray(offset, offset + this.binCount));
    return true;
  }

  /** Zero-copy view of a stored column. Valid only until that slot is overwritten. */
  columnView(col: number): Int8Array | null {
    if (!this.has(col)) return null;
    const offset = ringSlot(col, this.capacityCols) * this.binCount;
    return this.bins.subarray(offset, offset + this.binCount);
  }

  getF0(col: number): number {
    if (!this.has(col)) return F0_UNCOMPUTED;
    return this.f0[ringSlot(col, this.capacityCols)];
  }

  setF0(col: number, value: number): void {
    if (!this.has(col)) return;
    this.f0[ringSlot(col, this.capacityCols)] = value;
  }

  clear(): void {
    this.bins.fill(0);
    this.f0.fill(F0_UNCOMPUTED);
    this.written = 0;
  }
}
