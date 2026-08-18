import { DEFAULT_DB_FLOOR, DEFAULT_DB_RANGE } from "../config";
import type { ColumnStore } from "../store/columnStore";
import { ringSlot } from "../store/ring";
import { buildColormap, type ColormapName } from "./colormap";

export interface BlitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Renders spectrum columns into an offscreen canvas and composites it to
 * screen.
 *
 * The offscreen canvas is addressed as a ring: column c always occupies slot
 * `c % slots`, and a parallel table records which absolute column each slot
 * currently holds. Rendering a range then only touches slots whose recorded
 * column has changed — one column per frame while following, and only the
 * newly exposed columns when scrubbing. This replaces the self-copy blit
 * sketched in DESIGN.md §6: it is O(1) per new column in both modes, and it
 * avoids canvas-onto-itself drawImage with overlapping source and destination,
 * whose behaviour varies across WebView versions.
 *
 * Row r holds bin (binCount - 1 - r), so frequency increases upward and the
 * display crop for a frequency limit is a source rect off the top.
 */
export class WaterfallRenderer {
  readonly binCount: number;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Scratch for a run of columns. 256 wide keeps it under 1 MB at 600 bins. */
  private readonly batchWidth = 256;
  private readonly batch: ImageData;

  private lut: Uint8ClampedArray;
  private floorDb = DEFAULT_DB_FLOOR;
  private rangeDb = DEFAULT_DB_RANGE;

  private slots = 0;
  /** Absolute column currently held by each slot, or -1 if unrendered. */
  private slotCol = new Int32Array(0);

  /** The offscreen canvas is passed in rather than created here, per DESIGN.md §3.1. */
  constructor(canvas: HTMLCanvasElement, binCount: number, colormap: ColormapName = "magma") {
    this.binCount = binCount;
    this.lut = buildColormap(colormap);

    canvas.width = 1;
    canvas.height = binCount;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.batch = ctx.createImageData(this.batchWidth, binCount);
  }

  /**
   * The columns actually backed by ring slots for a requested range.
   *
   * sync and blit must agree on this exactly: sync decides which columns get
   * rendered *into* slots, blit decides which slots get drawn. If the two ever
   * computed a different `first`, blit would composite slots sync never wrote
   * — stale or blank columns, and no error raised. One definition makes that
   * agreement structural rather than a coincidence of identical typing.
   */
  private range(startCol: number, endCol: number): { first: number; to: number } {
    const from = Math.max(0, Math.floor(startCol));
    const to = Math.max(from, Math.ceil(endCol));
    // A range wider than the ring can only keep its last `slots` columns.
    return { first: Math.max(from, to - this.slots), to };
  }

  setColormap(name: ColormapName): void {
    this.lut = buildColormap(name);
    this.invalidate();
  }

  setDbRange(floorDb: number, rangeDb: number): void {
    this.floorDb = floorDb;
    this.rangeDb = Math.max(1, rangeDb);
    this.invalidate();
  }

  /** Grows the offscreen ring to hold at least `cols` columns. */
  ensureSlots(cols: number): void {
    const want = Math.max(1, Math.ceil(cols));
    if (want <= this.slots) return;
    this.slots = want;
    this.canvas.width = want; // resizing clears the canvas
    this.slotCol = new Int32Array(want).fill(-1);
  }

  /** Forces a full re-render on the next sync. */
  invalidate(): void {
    this.slotCol.fill(-1);
  }

  /**
   * Renders any column in [startCol, endCol) whose slot holds something else.
   *
   * Consecutive dirty slots are written with one putImageData per run rather
   * than one per column. In the steady state that is a single column either
   * way, but after an invalidate (colormap, dB range, zoom) every visible
   * column is dirty at once — 3200 of them at 0.5x zoom on a wide window — and
   * the per-call overhead is what turns that frame into a visible stutter.
   */
  sync(store: ColumnStore, startCol: number, endCol: number): void {
    if (this.slots === 0) return;
    const { first, to } = this.range(startCol, endCol);

    let runStart = -1;
    const flush = (endExclusive: number) => {
      if (runStart >= 0) {
        this.ctx.putImageData(
          this.batch,
          ringSlot(runStart, this.slots),
          0,
          0,
          0,
          endExclusive - runStart,
          this.binCount,
        );
        runStart = -1;
      }
    };

    for (let col = first; col < to; col++) {
      const slot = ringSlot(col, this.slots);
      if (this.slotCol[slot] === col) {
        flush(col);
        continue;
      }
      // A run cannot straddle the ring wrap, and the scratch buffer is bounded.
      if (runStart >= 0 && (slot === 0 || col - runStart >= this.batchWidth)) flush(col);
      if (runStart < 0) runStart = col;

      // A column the store does not have yet is drawn at the floor but NOT
      // cached, so the next frame retries. Caching it would freeze a screenful
      // of black in place until the ring wrapped past it.
      const ok = this.paintInto(store, col, col - runStart);
      this.slotCol[slot] = ok ? col : -1;
    }
    flush(to);
  }

  /**
   * Draws columns [startCol, endCol) into `dest`, cropping frequency to
   * bins [0, maxBin]. Splits into two draws at the ring wrap.
   *
   * `pxPerCol` is passed in rather than derived from `dest.w`, because the
   * drawn range is not always the requested one: before a screenful has been
   * recorded `startCol` is negative, and deriving the scale from the clamped
   * range would stretch the few real columns across the whole canvas. The
   * clamped-away columns become blank space via `offsetX` instead.
   */
  blit(
    ctx: CanvasRenderingContext2D,
    dest: BlitRect,
    startCol: number,
    endCol: number,
    maxBin: number,
    pxPerCol: number,
  ): void {
    if (this.slots === 0) return;
    const { first, to } = this.range(startCol, endCol);
    const count = to - first;
    if (count <= 0) return;

    const top = Math.min(this.binCount - 1, Math.max(0, maxBin));
    const sy = this.binCount - 1 - top;
    const sh = top + 1;
    const offsetX = dest.x + (first - startCol) * pxPerCol;

    ctx.imageSmoothingEnabled = false;

    const firstSlot = ringSlot(first, this.slots);
    const head = Math.min(count, this.slots - firstSlot);

    ctx.drawImage(this.canvas, firstSlot, sy, head, sh, offsetX, dest.y, head * pxPerCol, dest.h);

    const tail = count - head;
    if (tail > 0) {
      ctx.drawImage(
        this.canvas,
        0,
        sy,
        tail,
        sh,
        offsetX + head * pxPerCol,
        dest.y,
        tail * pxPerCol,
        dest.h,
      );
    }
  }

  /**
   * Paints one column into scratch column `at`. Returns whether the store
   * actually had the data; a false result must not be cached.
   */
  private paintInto(store: ColumnStore, col: number, at: number): boolean {
    const pixels = this.batch.data;
    const stride = this.batchWidth * 4;
    const view = store.columnView(col);
    const lut = this.lut;

    if (!view) {
      // Missing column: paint the colormap's floor rather than leaving stale data.
      for (let r = 0; r < this.binCount; r++) {
        const p = r * stride + at * 4;
        pixels[p] = lut[0];
        pixels[p + 1] = lut[1];
        pixels[p + 2] = lut[2];
        pixels[p + 3] = 255;
      }
      return false;
    }

    const inv = 255 / this.rangeDb;
    for (let bin = 0; bin < this.binCount; bin++) {
      let idx = Math.round((view[bin] - this.floorDb) * inv);
      if (idx < 0) idx = 0;
      else if (idx > 255) idx = 255;
      const s = idx * 4;
      const p = (this.binCount - 1 - bin) * stride + at * 4;
      pixels[p] = lut[s];
      pixels[p + 1] = lut[s + 1];
      pixels[p + 2] = lut[s + 2];
      pixels[p + 3] = 255;
    }
    return true;
  }
}
