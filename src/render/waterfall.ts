import { DEFAULT_DB_FLOOR, DEFAULT_DB_RANGE } from "../config";
import type { ColumnStore } from "../store/columnStore";
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
  private readonly columnData: ImageData;

  private lut: Uint8ClampedArray;
  private floorDb = DEFAULT_DB_FLOOR;
  private rangeDb = DEFAULT_DB_RANGE;

  private slots = 0;
  /** Absolute column currently held by each slot, or -1 if unrendered. */
  private slotCol = new Int32Array(0);

  constructor(binCount: number, colormap: ColormapName = "magma") {
    this.binCount = binCount;
    this.lut = buildColormap(colormap);

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = binCount;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.columnData = ctx.createImageData(1, binCount);
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

  /** Renders any column in [startCol, endCol) whose slot holds something else. */
  sync(store: ColumnStore, startCol: number, endCol: number): void {
    if (this.slots === 0) return;
    const from = Math.max(0, Math.floor(startCol));
    const to = Math.max(from, Math.ceil(endCol));
    // A range wider than the ring can only keep its last `slots` columns.
    const first = Math.max(from, to - this.slots);

    for (let col = first; col < to; col++) {
      const slot = ((col % this.slots) + this.slots) % this.slots;
      if (this.slotCol[slot] === col) continue;
      this.renderColumn(store, col, slot);
      this.slotCol[slot] = col;
    }
  }

  /**
   * Draws columns [startCol, endCol) into `dest`, cropping frequency to
   * bins [0, maxBin]. Splits into two draws at the ring wrap.
   */
  blit(
    ctx: CanvasRenderingContext2D,
    dest: BlitRect,
    startCol: number,
    endCol: number,
    maxBin: number,
  ): void {
    if (this.slots === 0) return;
    const from = Math.max(0, Math.floor(startCol));
    const to = Math.max(from, Math.ceil(endCol));
    const count = Math.min(to - from, this.slots);
    if (count === 0) return;

    const top = Math.min(this.binCount - 1, Math.max(0, maxBin));
    const sy = this.binCount - 1 - top;
    const sh = top + 1;
    const pxPerCol = dest.w / (to - from);

    ctx.imageSmoothingEnabled = false;

    const firstSlot = ((from % this.slots) + this.slots) % this.slots;
    const head = Math.min(count, this.slots - firstSlot);

    ctx.drawImage(
      this.canvas,
      firstSlot,
      sy,
      head,
      sh,
      dest.x,
      dest.y,
      head * pxPerCol,
      dest.h,
    );

    const tail = count - head;
    if (tail > 0) {
      ctx.drawImage(
        this.canvas,
        0,
        sy,
        tail,
        sh,
        dest.x + head * pxPerCol,
        dest.y,
        tail * pxPerCol,
        dest.h,
      );
    }
  }

  private renderColumn(store: ColumnStore, col: number, slot: number): void {
    const pixels = this.columnData.data;
    const view = store.columnView(col);
    const lut = this.lut;

    if (!view) {
      // Missing column: paint the colormap's floor rather than leaving stale data.
      for (let r = 0; r < this.binCount; r++) {
        const p = r * 4;
        pixels[p] = lut[0];
        pixels[p + 1] = lut[1];
        pixels[p + 2] = lut[2];
        pixels[p + 3] = 255;
      }
    } else {
      const inv = 255 / this.rangeDb;
      for (let bin = 0; bin < this.binCount; bin++) {
        let idx = Math.round((view[bin] - this.floorDb) * inv);
        if (idx < 0) idx = 0;
        else if (idx > 255) idx = 255;
        const s = idx * 4;
        const p = (this.binCount - 1 - bin) * 4;
        pixels[p] = lut[s];
        pixels[p + 1] = lut[s + 1];
        pixels[p + 2] = lut[s + 2];
        pixels[p + 3] = 255;
      }
    }

    this.ctx.putImageData(this.columnData, slot, 0);
  }
}
