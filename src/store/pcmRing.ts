/**
 * Int16 PCM ring buffer — the single source of truth for recorded audio
 * (DESIGN.md §3.2).
 *
 * Indices are absolute sample counts that never reset. Overwriting is
 * expressed by `earliestIndex` moving forward, so a timeline built on these
 * indices stays correct after the ring wraps rather than drifting.
 *
 * Int16 rather than Float32 halves the 8-minute budget to 46 MB, and the
 * quantisation floor (-90 dBFS) sits below the display floor (-92 dBFS
 * default) and the YIN silence gate (-55 dBFS), so nothing downstream can see
 * it.
 */
export class PcmRing {
  readonly capacity: number;
  private readonly data: Int16Array;
  private written = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.data = new Int16Array(capacity);
  }

  /** Absolute count of samples ever written. Never resets. */
  get writeIndex(): number {
    return this.written;
  }

  /** Lowest absolute index still retained. */
  get earliestIndex(): number {
    return Math.max(0, this.written - this.capacity);
  }

  write(chunk: Float32Array): void {
    const n = chunk.length;
    if (n === 0) return;

    // A chunk longer than the ring would only leave its tail; skip the rest.
    // The slot must still come from the absolute index, not from a counter
    // that ignores the skip, or the retained tail lands at the wrong offset.
    const skip = Math.max(0, n - this.capacity);
    for (let i = skip; i < n; i++) {
      const q = Math.round(chunk[i] * 32767);
      this.data[(this.written + i) % this.capacity] =
        q > 32767 ? 32767 : q < -32768 ? -32768 : q;
    }
    this.written += n;
  }

  /**
   * Fills `out` with samples starting at absolute index `start`, converted to
   * float. Positions outside the retained range are zero-filled. Returns how
   * many real samples were written.
   */
  read(start: number, out: Float32Array): number {
    const earliest = this.earliestIndex;
    let filled = 0;
    for (let i = 0; i < out.length; i++) {
      const abs = start + i;
      if (abs < earliest || abs >= this.written) {
        out[i] = 0;
      } else {
        out[i] = this.data[((abs % this.capacity) + this.capacity) % this.capacity] / 32768;
        filled++;
      }
    }
    return filled;
  }

  /** Raw Int16 copy of `count` samples from absolute index `start`, zero-padded. */
  readInt16(start: number, count: number): Int16Array {
    const out = new Int16Array(count);
    const earliest = this.earliestIndex;
    for (let i = 0; i < count; i++) {
      const abs = start + i;
      if (abs >= earliest && abs < this.written) {
        out[i] = this.data[((abs % this.capacity) + this.capacity) % this.capacity];
      }
    }
    return out;
  }

  clear(): void {
    this.data.fill(0);
    this.written = 0;
  }
}
