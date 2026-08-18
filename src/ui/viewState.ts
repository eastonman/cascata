import { HOP } from "../config";

export interface ViewStateOptions {
  sampleRate: number;
}

/**
 * The view half of the two orthogonal states in DESIGN.md §7: following the
 * live edge, or pinned to a stretch of history. Capture is the other, and the
 * two never interact — stopping capture leaves the view alone, and pinning the
 * view never interrupts capture.
 *
 * Kept free of DOM references so the interaction rules can be tested directly;
 * the app owns the canvas and feeds this widthPx and pointer deltas.
 *
 * Data enters at the right edge and scrolls left. Before a full screen has
 * been recorded startCol runs negative, which renders as blank space to the
 * left of the trace rather than the trace starting from the left.
 */
export class ViewState {
  readonly sampleRate: number;

  private width = 0;
  private zoom = 1;
  private latest = 0;
  private earliest = 0;
  private pinnedStart = 0;
  private isFollowing = true;

  constructor(opts: ViewStateOptions) {
    this.sampleRate = opts.sampleRate;
  }

  get widthPx(): number {
    return this.width;
  }

  set widthPx(value: number) {
    const start = this.startCol;
    this.width = Math.max(0, value);
    if (!this.isFollowing) this.pinnedStart = start;
  }

  get pxPerCol(): number {
    return this.zoom;
  }

  /** Zooming keeps the right edge while following, and startCol while pinned. */
  set pxPerCol(value: number) {
    const start = this.startCol;
    this.zoom = Math.max(0.01, value);
    if (!this.isFollowing) this.pinnedStart = start;
  }

  get visibleCols(): number {
    return this.zoom > 0 ? Math.ceil(this.width / this.zoom) : 0;
  }

  get following(): boolean {
    return this.isFollowing;
  }

  get startCol(): number {
    return this.isFollowing ? this.latest - this.visibleCols : this.pinnedStart;
  }

  get endCol(): number {
    return this.startCol + this.visibleCols;
  }

  setLatest(col: number): void {
    this.latest = col;
    if (!this.isFollowing) this.pinnedStart = this.clampStart(this.pinnedStart);
  }

  setEarliest(col: number): void {
    this.earliest = col;
    if (!this.isFollowing) this.pinnedStart = this.clampStart(this.pinnedStart);
  }

  follow(): void {
    this.isFollowing = true;
  }

  /** Raw pointer delta: dragging right (dx > 0) moves the view back in time. */
  panPixels(dx: number): void {
    this.panColumns(-dx / this.zoom);
  }

  /** Column delta applied to startCol: negative goes back in time. */
  panColumns(dc: number): void {
    const target = this.startCol + dc;
    const maxStart = this.latest - this.visibleCols;
    if (target >= maxStart) {
      // Pushed to or past the live edge: there is nothing newer to reveal.
      this.isFollowing = true;
      return;
    }
    this.isFollowing = false;
    this.pinnedStart = this.clampStart(target);
  }

  /** Shifts a pinned view the minimum needed to bring `col` inside. No-op while following. */
  ensureVisible(col: number): void {
    if (this.isFollowing) return;
    const start = this.pinnedStart;
    const span = this.visibleCols;
    if (col < start) this.pinnedStart = this.clampStart(col);
    else if (col >= start + span) this.pinnedStart = this.clampStart(col - span + 1);
  }

  xToCol(x: number): number {
    return this.startCol + Math.floor(x / this.zoom);
  }

  colToX(col: number): number {
    return (col - this.startCol) * this.zoom;
  }

  colToTime(col: number): number {
    return (col * HOP) / this.sampleRate;
  }

  timeToCol(seconds: number): number {
    return Math.round((seconds * this.sampleRate) / HOP);
  }

  colToSample(col: number): number {
    return col * HOP;
  }

  sampleToCol(sample: number): number {
    return Math.floor(sample / HOP);
  }

  /**
   * Bounds a pinned start to the retained range. When less than a screenful is
   * retained the lower bound collapses onto the upper one, which parks the
   * view at the live edge instead of forcing a jump.
   */
  private clampStart(value: number): number {
    const maxStart = this.latest - this.visibleCols;
    const minStart = Math.min(this.earliest, maxStart);
    return Math.round(Math.min(maxStart, Math.max(minStart, value)));
  }
}
