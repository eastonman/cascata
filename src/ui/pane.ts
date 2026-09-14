import { Analyzer } from "../analysis/analyzer";
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
import { ColumnStore } from "../store/columnStore";
import { PcmRing } from "../store/pcmRing";
import { ViewState } from "./viewState";

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

  private pcm: PcmRing | null = null;
  private columns: ColumnStore | null = null;
  private analyzer: Analyzer | null = null;
  private view: ViewState | null = null;

  private sampleRateHz = 0;
  private capacitySec = 0;
  private maxBin = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private cursorColValue: number | null = null;
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

    const header = document.createElement("div");
    header.className = "pane-header";

    const name = document.createElement("span");
    name.className = "pane-label";
    name.textContent = label;

    this.armDot = document.createElement("button");
    this.armDot.className = "arm";
    this.armDot.title = "Record into this pane";
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
    this.importBtn.addEventListener("click", () => {
      this.importBtn.blur();
      this.fileInput.click();
    });

    this.clearBtn = document.createElement("button");
    this.clearBtn.textContent = "Clear";
    this.clearBtn.disabled = true;
    this.clearBtn.addEventListener("click", () => {
      this.clearBtn.blur();
      callbacks.onClear(this);
    });

    this.durationEl = document.createElement("span");
    this.durationEl.className = "pane-duration";

    header.append(this.armDot, name, this.importBtn, this.clearBtn, this.durationEl);

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
    return (this.pcm?.writeIndex ?? 0) > 0;
  }

  get sampleRate(): number {
    return this.sampleRateHz;
  }

  get capacitySeconds(): number {
    return this.capacitySec;
  }

  get viewState(): ViewState | null {
    return this.view;
  }

  get cursorCol(): number | null {
    return this.cursorColValue;
  }

  get pcmRange(): { earliest: number; writeIndex: number } | null {
    return this.pcm ? { earliest: this.pcm.earliestIndex, writeIndex: this.pcm.writeIndex } : null;
  }

  /** Columns of analysis still owed, used to split the frame budget and report progress. */
  get backlogColumns(): number {
    if (!this.analyzer || !this.pcm) return 0;
    return Math.max(0, Math.floor(this.pcm.writeIndex / HOP) - this.analyzer.cursor);
  }

  // --- lifecycle -----------------------------------------------------------

  build(sampleRate: number, capacitySeconds: number, settings: Settings): void {
    this.sampleRateHz = sampleRate;
    this.capacitySec = capacitySeconds;

    const capacity = Math.ceil(capacitySeconds * sampleRate);
    this.pcm = new PcmRing(capacity);
    this.columns = new ColumnStore(Math.ceil(capacity / HOP), BIN_COUNT);
    this.analyzer = new Analyzer({ sampleRate, pcm: this.pcm, columns: this.columns });
    this.analyzer.setFftSize(settings.fftSize);
    this.analyzer.setPitchEnabled(settings.pitchEnabled);

    this.view = new ViewState({ sampleRate });
    this.view.pxPerCol = settings.timeZoom;
    this.view.widthPx = this.cssWidth;

    this.waterfall.invalidate();
  }

  writeSamples(chunk: Float32Array): void {
    this.pcm?.write(chunk);
  }

  /** Reads float samples out of the ring, for playback and for export sizing. */
  fillSamples(startSample: number, channel: Float32Array): void {
    this.pcm?.read(startSample, channel);
  }

  readInt16(startSample: number, count: number): Int16Array | null {
    return this.pcm?.readInt16(startSample, count) ?? null;
  }

  /** Advances analysis for at most `budgetMs`. Returns columns produced. */
  pump(budgetMs: number): number {
    const analyzer = this.analyzer;
    if (!analyzer) return 0;
    const deadline = performance.now() + budgetMs;
    let produced = 0;
    do {
      const n = analyzer.pump(64);
      if (n === 0) break;
      produced += n;
    } while (performance.now() < deadline);
    return produced;
  }

  clear(): void {
    this.pcm?.clear();
    this.analyzer?.reset();
    this.waterfall.invalidate();
    this.cursorColValue = null;
    this.view?.follow();
    this.shownHasData = null;
    this.refreshHeader();
  }

  /** Places the play cursor, e.g. after switching panes mid-playback. */
  showCursorAt(col: number): void {
    this.cursorColValue = Math.max(0, col);
  }

  /** Pins the view to the very start, for an import that should be read from its beginning. */
  showFromStart(latestCol: number): void {
    if (!this.view) return;
    this.view.setEarliest(0);
    this.view.setLatest(latestCol);
    this.view.panColumns(-Number.MAX_SAFE_INTEGER);
    this.cursorColValue = 0;
  }

  // --- settings and layout -------------------------------------------------

  applySettings(patch: Partial<Settings>, settings: Settings): void {
    if (patch.fftSize !== undefined) this.analyzer?.setFftSize(patch.fftSize);
    if (patch.pitchEnabled !== undefined) this.analyzer?.setPitchEnabled(patch.pitchEnabled);
    if (patch.colormap !== undefined) this.waterfall.setColormap(patch.colormap);
    if (patch.dbFloor !== undefined || patch.dbRange !== undefined) {
      this.waterfall.setDbRange(settings.dbFloor, settings.dbRange);
    }
    if (patch.timeZoom !== undefined && this.view) {
      this.view.pxPerCol = patch.timeZoom;
      this.waterfall.ensureSlots(this.view.visibleCols);
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

    if (this.view) {
      this.view.widthPx = w;
      this.waterfall.ensureSlots(this.view.visibleCols);
    }
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

    const samples = this.pcm ? this.pcm.writeIndex - this.pcm.earliestIndex : 0;
    const duration =
      samples > 0 && this.sampleRateHz > 0 ? formatClock(samples / this.sampleRateHz) : "";
    if (duration !== this.shownDuration) {
      this.shownDuration = duration;
      this.durationEl.textContent = duration;
    }
  }

  // --- coordinates ---------------------------------------------------------

  /** Column under a client-space x, or null when this pane has no view yet. */
  colAtClientX(clientX: number): number | null {
    if (!this.view) return null;
    const rect = this.canvas.getBoundingClientRect();
    return this.view.xToCol(clientX - rect.left);
  }

  /** Column the pointer is over, for the other pane's ghost cursor. */
  get hoveredCol(): number | null {
    if (!this.hover || !this.view) return null;
    return this.view.xToCol(this.hover.x);
  }

  // --- drawing -------------------------------------------------------------

  draw(settings: Settings, opts: DrawOptions): void {
    const w = this.cssWidth;
    const h = this.cssHeight;
    if (w === 0 || h === 0) return;

    this.root.dataset.active = String(opts.active);

    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, w, h);

    const { view, columns } = this;
    if (!view || !columns) return;

    view.setLatest(columns.writeIndex);
    view.setEarliest(columns.earliestIndex);

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
      sampleRate: this.sampleRateHz,
    };

    drawNoteRuler(this.ctx, geo);
    drawTimeAxis(this.ctx, geo);
    if (settings.pitchEnabled) drawPitchCurve(this.ctx, geo, columns);
    if (opts.ghostCol !== null) drawGhostCursor(this.ctx, geo, opts.ghostCol);
    if (this.cursorColValue !== null) drawPlayCursor(this.ctx, geo, this.cursorColValue);
    if (opts.playheadCol !== null) drawPlayhead(this.ctx, geo, opts.playheadCol);
    this.drawHover(geo, columns, settings);
  }

  private drawHover(geo: OverlayGeometry, columns: ColumnStore, settings: Settings): void {
    const hover = this.hover;
    if (!hover || !this.view) return;

    const col = this.view.xToCol(hover.x);
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
      formatReadout({ timeSec: this.view.colToTime(col), freq, db, a4: settings.a4 }),
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
        this.view?.panPixels(dx);
        this.callbacks.onViewChanged(this);
      }
    });

    const endPointer = (e: PointerEvent) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      this.pointer = null;
      if (p.totalMovement <= DRAG_THRESHOLD_PX) {
        const col = this.colAtClientX(e.clientX);
        if (col !== null) this.cursorColValue = col;
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
