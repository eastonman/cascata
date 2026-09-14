import { BIN_COUNT, F_MAX, F_MIN, HOP } from "../config";
import { freqToBin } from "../dsp/logBins";
import type { Settings } from "../platform/settings";
import {
  drawCrosshair,
  drawGhostCursor,
  drawNoteRuler,
  drawPitchCurve,
  drawPlayCursor,
  drawPlayhead,
  drawTimeAxis,
  formatClock,
  formatReadout,
  type OverlayGeometry,
  yToBin,
  yToFreq,
} from "../render/overlay";
import { WaterfallRenderer } from "../render/waterfall";
import type { ColumnStore } from "../store/columnStore";
import { PaneModel } from "./paneModel";
import type { ViewState } from "./viewState";

/** Pointer movement past this is a drag, below it a tap that sets the cursor. */
const DRAG_THRESHOLD_PX = 4;

export interface PaneCallbacks {
  onImport(pane: Pane, file: File): void;
  onClear(pane: Pane): void;
  onArm(pane: Pane): void;
  /** The user panned or zoomed this pane; the app mirrors it when linked. */
  onViewChanged(pane: Pane): void;
  /** The user interacted with this pane at all, so it becomes the active one. */
  onActivate(pane: Pane): void;
}

export interface DrawOptions {
  active: boolean;
  /** Column in *this* pane matching where the pointer is in the other one. */
  ghostCol: number | null;
  /** Column to draw a playhead at, or null when this pane is not sounding. */
  playheadCol: number | null;
}

/**
 * One recording: its audio, its analysis, its view, and its rendering.
 *
 * A Pane never touches the AudioContext, the microphone, or the global control
 * bar — the app owns those and hands samples down, which is what keeps "two
 * panes recording at once" from being representable. Everything here is scoped
 * to a single buffer, so the comparison feature is two of these rather than a
 * second code path through one.
 */
export class Pane {
  readonly label: string;
  readonly root: HTMLDivElement;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hint: HTMLDivElement;
  private readonly durationEl: HTMLSpanElement;
  private readonly armDot: HTMLButtonElement;
  private readonly importBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly waterfall: WaterfallRenderer;
  private readonly callbacks: PaneCallbacks;

  /** Everything about this pane that is not DOM. Tested directly; see paneModel.test.ts. */
  readonly model = new PaneModel();

  private maxBin = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private hover: { x: number; y: number } | null = null;
  private pointer: { id: number; lastX: number; totalMovement: number } | null = null;
  /** Last values written to the header, so the draw loop does not rewrite them 60x/s. */
  private shownDuration = "";
  private shownHasData: boolean | null = null;

  constructor(label: string, callbacks: PaneCallbacks, settings: Settings) {
    this.label = label;
    this.callbacks = callbacks;

    this.root = document.createElement("div");
    this.root.className = "pane";
    this.root.dataset.pane = label;

    const header = document.createElement("div");
    header.className = "pane-header";

    const name = document.createElement("span");
    name.className = "pane-label";
    name.textContent = label;

    this.armDot = document.createElement("button");
    this.armDot.className = "arm";
    this.armDot.title = `Record into pane ${label}`;
    // A bare circle has no text to announce; title is a tooltip, not a name.
    this.armDot.setAttribute("aria-label", `Record into pane ${label}`);
    this.armDot.addEventListener("click", () => {
      this.armDot.blur();
      callbacks.onArm(this);
    });

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "audio/*";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      // Reset first, so picking the same file twice in a row still fires change.
      this.fileInput.value = "";
      if (file) callbacks.onImport(this, file);
    });

    this.importBtn = document.createElement("button");
    this.importBtn.textContent = "Import";
    this.importBtn.setAttribute("aria-label", `Import audio into pane ${label}`);
    this.importBtn.addEventListener("click", () => {
      this.importBtn.blur();
      this.fileInput.click();
    });

    this.clearBtn = document.createElement("button");
    this.clearBtn.textContent = "Clear";
    this.clearBtn.setAttribute("aria-label", `Clear pane ${label}`);
    this.clearBtn.disabled = true;
    this.clearBtn.addEventListener("click", () => {
      this.clearBtn.blur();
      callbacks.onClear(this);
    });

    this.durationEl = document.createElement("span");
    this.durationEl.className = "pane-duration";

    // The input has to be in the document: click() on a detached file input
    // does not reliably open the picker, which made Import a dead button.
    header.append(
      this.armDot,
      name,
      this.importBtn,
      this.clearBtn,
      this.fileInput,
      this.durationEl,
    );

    const stage = document.createElement("div");
    stage.className = "pane-stage";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "waterfall";
    this.hint = document.createElement("div");
    this.hint.className = "pane-hint";
    this.hint.textContent = "Record or import audio.";
    stage.append(this.canvas, this.hint);

    this.root.append(header, stage);

    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.waterfall = new WaterfallRenderer(
      document.createElement("canvas"),
      BIN_COUNT,
      settings.colormap,
    );
    this.waterfall.setDbRange(settings.dbFloor, settings.dbRange);
    this.maxBin = computeMaxBin(settings);

    this.bindPointer();
  }

  // --- state ---------------------------------------------------------------

  get hasData(): boolean {
    return this.model.hasData;
  }

  get sampleRate(): number {
    return this.model.sampleRate;
  }

  get capacitySeconds(): number {
    return this.model.capacitySeconds;
  }

  get viewState(): ViewState | null {
    return this.model.viewState;
  }

  get cursorCol(): number | null {
    return this.model.cursorCol;
  }

  get pcmRange(): { earliest: number; writeIndex: number } | null {
    return this.model.pcmRange;
  }

  get backlogColumns(): number {
    return this.model.backlogColumns;
  }

  get analysisProgress(): number {
    return this.model.analysisProgress;
  }

  // --- lifecycle -----------------------------------------------------------

  build(sampleRate: number, capacitySeconds: number, settings: Settings): void {
    this.model.build(sampleRate, capacitySeconds, settings, this.cssWidth);
    this.waterfall.invalidate();
  }

  writeSamples(chunk: Float32Array): void {
    this.model.writeSamples(chunk);
  }

  /** Reads float samples out of the ring, for playback and for export sizing. */
  fillSamples(startSample: number, channel: Float32Array): void {
    this.model.fillSamples(startSample, channel);
  }

  readInt16(startSample: number, count: number): Int16Array | null {
    return this.model.readInt16(startSample, count);
  }

  /** Advances analysis for at most `budgetMs`. Returns columns produced. */
  pump(budgetMs: number): number {
    return this.model.pump(budgetMs);
  }

  clear(): void {
    this.model.clear();
    this.waterfall.invalidate();
    this.shownHasData = null;
    this.refreshHeader();
  }

  /** Places the play cursor, e.g. after switching panes mid-playback. */
  showCursorAt(col: number): void {
    this.model.showCursorAt(col);
  }

  showFromStart(latestCol: number): void {
    this.model.showFromStart(latestCol);
  }

  // --- settings and layout -------------------------------------------------

  applySettings(patch: Partial<Settings>, settings: Settings): void {
    this.model.applyAnalysisSettings(patch);
    if (patch.colormap !== undefined) this.waterfall.setColormap(patch.colormap);
    if (patch.dbFloor !== undefined || patch.dbRange !== undefined) {
      this.waterfall.setDbRange(settings.dbFloor, settings.dbRange);
    }
    if (patch.timeZoom !== undefined) {
      const view = this.model.viewState;
      if (view) this.waterfall.ensureSlots(view.visibleCols);
      this.waterfall.invalidate();
    }
    if (patch.freqLimit !== undefined) this.maxBin = computeMaxBin(settings);
  }

  /** Sizes the backing store to the pane's current box. Returns false when it has no box yet. */
  resize(dpr: number): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return false;

    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    // Assigning width/height clears the canvas even when unchanged, and
    // ResizeObserver fires after the frame's rAF callbacks -- an unconditional
    // assignment composites a blank canvas for the whole of a resize drag.
    if (this.canvas.width === bw && this.canvas.height === bh && this.cssWidth === w) return true;

    this.canvas.width = bw;
    this.canvas.height = bh;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = w;
    this.cssHeight = h;

    this.model.setViewWidth(w);
    const view = this.model.viewState;
    if (view) this.waterfall.ensureSlots(view.visibleCols);
    return true;
  }

  setArmed(armed: boolean): void {
    this.armDot.dataset.armed = String(armed);
  }

  setImportEnabled(enabled: boolean): void {
    this.importBtn.disabled = !enabled;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  refreshHeader(): void {
    const has = this.hasData;
    if (has !== this.shownHasData) {
      this.shownHasData = has;
      this.clearBtn.disabled = !has;
      this.hint.hidden = has;
    }

    const seconds = this.model.durationSeconds;
    const duration = seconds > 0 ? formatClock(seconds) : "";
    if (duration !== this.shownDuration) {
      this.shownDuration = duration;
      this.durationEl.textContent = duration;
    }
  }

  // --- coordinates ---------------------------------------------------------

  /** Column under a client-space x, or null when this pane has no view yet. */
  colAtClientX(clientX: number): number | null {
    const view = this.model.viewState;
    if (!view) return null;
    const rect = this.canvas.getBoundingClientRect();
    return view.xToCol(clientX - rect.left);
  }

  /** Column the pointer is over, for the other pane's ghost cursor. */
  get hoveredCol(): number | null {
    const view = this.model.viewState;
    if (!this.hover || !view) return null;
    return view.xToCol(this.hover.x);
  }

  // --- drawing -------------------------------------------------------------

  draw(settings: Settings, opts: DrawOptions): void {
    const w = this.cssWidth;
    const h = this.cssHeight;
    if (w === 0 || h === 0) return;

    this.root.dataset.active = String(opts.active);

    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, w, h);

    const view = this.model.viewState;
    const columns = this.model.columns;
    if (!view || !columns) return;

    this.model.syncViewBounds();

    const startCol = view.startCol;
    const endCol = view.endCol;
    this.waterfall.ensureSlots(view.visibleCols);
    this.waterfall.sync(columns, startCol, endCol);
    this.waterfall.blit(
      this.ctx,
      { x: 0, y: 0, w, h },
      startCol,
      endCol,
      this.maxBin,
      view.pxPerCol,
    );

    const geo: OverlayGeometry = {
      x: 0,
      y: 0,
      w,
      h,
      startCol,
      endCol,
      pxPerCol: view.pxPerCol,
      maxBin: this.maxBin,
      binCount: BIN_COUNT,
      fMin: F_MIN,
      fMax: F_MAX,
      a4: settings.a4,
      hop: HOP,
      sampleRate: this.model.sampleRate,
    };

    drawNoteRuler(this.ctx, geo);
    drawTimeAxis(this.ctx, geo);
    if (settings.pitchEnabled) drawPitchCurve(this.ctx, geo, columns);
    if (opts.ghostCol !== null) drawGhostCursor(this.ctx, geo, opts.ghostCol);
    const cursor = this.model.cursorCol;
    if (cursor !== null) drawPlayCursor(this.ctx, geo, cursor);
    if (opts.playheadCol !== null) drawPlayhead(this.ctx, geo, opts.playheadCol);
    this.drawHover(geo, columns, settings);
  }

  private drawHover(geo: OverlayGeometry, columns: ColumnStore, settings: Settings): void {
    const hover = this.hover;
    const view = this.model.viewState;
    if (!hover || !view) return;

    const col = view.xToCol(hover.x);
    const freq = yToFreq(hover.y, geo);
    const stored = columns.columnView(col);
    // yToFreq exponentiates the bin position, so converting the frequency back
    // to a bin would just undo it. Take the bin straight from the y.
    const bin = Math.round(yToBin(hover.y, geo));
    const db = stored && bin >= 0 && bin < BIN_COUNT ? stored[bin] : -127;

    drawCrosshair(
      this.ctx,
      geo,
      hover.x,
      hover.y,
      formatReadout({ timeSec: view.colToTime(col), freq, db, a4: settings.a4 }),
    );
  }

  // --- input ---------------------------------------------------------------

  private bindPointer(): void {
    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointer = { id: e.pointerId, lastX: e.clientX, totalMovement: 0 };
      this.callbacks.onActivate(this);
    });

    this.canvas.addEventListener("pointermove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.lastX;
      p.lastX = e.clientX;
      p.totalMovement += Math.abs(dx);
      if (p.totalMovement > DRAG_THRESHOLD_PX) {
        this.model.viewState?.panPixels(dx);
        this.callbacks.onViewChanged(this);
      }
    });

    const endPointer = (e: PointerEvent) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      this.pointer = null;
      if (p.totalMovement <= DRAG_THRESHOLD_PX) {
        const col = this.colAtClientX(e.clientX);
        if (col !== null) this.model.showCursorAt(col);
      }
    };
    this.canvas.addEventListener("pointerup", endPointer);
    this.canvas.addEventListener("pointercancel", endPointer);
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
    });
  }
}

/** Highest stored bin the display limit reaches. */
function computeMaxBin(settings: Settings): number {
  const bin = freqToBin(settings.freqLimit, F_MIN, F_MAX, BIN_COUNT);
  return Math.min(BIN_COUNT - 1, Math.max(1, Math.round(bin)));
}
