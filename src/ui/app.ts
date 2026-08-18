import {
  BIN_COUNT,
  F_MAX,
  F_MIN,
  HOP,
  MAX_PLAYBACK_SECONDS,
  RECORD_SECONDS,
} from "../config";
import { Analyzer } from "../analysis/analyzer";
import { Player } from "../audio/player";
import { WebAudioSource } from "../audio/webAudioSource";
import { encodeWav } from "../export/wav";
import { saveBlob } from "../platform/files";
import { loadSettings, saveSettings, type Settings } from "../platform/settings";
import {
  drawCrosshair,
  drawNoteRuler,
  drawPitchCurve,
  drawPlayCursor,
  drawPlayhead,
  drawTimeAxis,
  formatClock,
  formatReadout,
  yToFreq,
  type OverlayGeometry,
} from "../render/overlay";
import { WaterfallRenderer } from "../render/waterfall";
import { ColumnStore } from "../store/columnStore";
import { PcmRing } from "../store/pcmRing";
import { createControls, type ControlsHandle } from "./controls";
import { ViewState } from "./viewState";

/** Pointer movement past this is a drag, below it a tap that sets the cursor. */
const DRAG_THRESHOLD_PX = 4;

interface Pointer {
  id: number;
  lastX: number;
  totalMovement: number;
}

/**
 * Owns every runtime object and the draw loop.
 *
 * The data path is one-way and matches DESIGN.md §3.3: capture writes PCM and
 * nothing else; the analyzer derives columns from that PCM; rendering reads
 * columns. Nothing downstream can write back, which is what keeps live view
 * and playback view identical.
 */
export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hint: HTMLDivElement;
  private readonly controls: ControlsHandle;

  private settings: Settings;
  private readonly source = new WebAudioSource();
  private pcm: PcmRing | null = null;
  private columns: ColumnStore | null = null;
  private analyzer: Analyzer | null = null;
  private player: Player | null = null;
  private waterfall = new WaterfallRenderer(BIN_COUNT);
  private view: ViewState | null = null;

  private sampleRate = 0;
  private capturing = false;
  private cursorCol = 0;
  private hasCursor = false;
  private pointer: Pointer | null = null;
  private hover: { x: number; y: number } | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private frame = 0;

  constructor(root: HTMLElement) {
    this.settings = loadSettings();

    this.controls = createControls(root, this.settings, {
      onToggleCapture: () => void this.toggleCapture(),
      onTogglePlay: () => this.togglePlay(),
      onFollow: () => this.view?.follow(),
      onExport: () => this.exportWav(),
      onSettingsChange: (patch) => this.applySettings(patch),
    });

    const stage = document.createElement("div");
    stage.id = "stage";
    this.canvas = document.createElement("canvas");
    this.canvas.id = "waterfall";
    this.hint = document.createElement("div");
    this.hint.id = "hint";
    this.hint.textContent = "Press Record to start listening.";
    stage.append(this.canvas, this.hint);
    root.append(stage);

    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.waterfall.setColormap(this.settings.colormap);
    this.waterfall.setDbRange(this.settings.dbFloor, this.settings.dbRange);

    this.controls.setCaptureState(false);
    this.controls.setPlayState(false);
    this.controls.setFollowState(true);
    this.controls.setExportEnabled(false);
    this.controls.setPlayEnabled(false);

    this.bindPointer();
    this.bindKeyboard();
    this.bindResize();
    this.bindVisibility();
  }

  start(): void {
    this.resizeCanvas();
    const loop = () => {
      this.tick();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  // --- capture -------------------------------------------------------------

  private async toggleCapture(): Promise<void> {
    if (this.capturing) {
      await this.source.stop();
      this.capturing = false;
      this.controls.setCaptureState(false);
      this.controls.setStatus("Stopped");
      void this.releaseWakeLock();
      return;
    }

    try {
      await this.source.start((chunk) => this.pcm?.write(chunk));
    } catch (err) {
      this.controls.setStatus(`Microphone unavailable: ${(err as Error).message}`);
      return;
    }

    // Stores are sized from the real device rate, which is only known once the
    // context exists. Rate changes between sessions rebuild them.
    if (this.sampleRate !== this.source.sampleRate) {
      this.sampleRate = this.source.sampleRate;
      this.buildStores();
    }

    this.capturing = true;
    this.hint.hidden = true;
    this.controls.setCaptureState(true);
    this.controls.setPlayEnabled(true);
    this.controls.setExportEnabled(true);
    void this.acquireWakeLock();
  }

  private buildStores(): void {
    const capacity = Math.ceil(RECORD_SECONDS * this.sampleRate);
    this.pcm = new PcmRing(capacity);
    this.columns = new ColumnStore(Math.ceil(capacity / HOP), BIN_COUNT);
    this.analyzer = new Analyzer({
      sampleRate: this.sampleRate,
      pcm: this.pcm,
      columns: this.columns,
    });
    this.analyzer.setFftSize(this.settings.fftSize);
    this.analyzer.setPitchEnabled(this.settings.pitchEnabled);

    this.view = new ViewState({ sampleRate: this.sampleRate });
    this.view.pxPerCol = this.settings.timeZoom;
    this.view.widthPx = this.canvas.clientWidth;

    const audioContext = this.source.audioContext;
    if (audioContext) {
      this.player = new Player(audioContext);
      this.player.onEnded = () => this.controls.setPlayState(false);
    }

    this.waterfall.invalidate();
  }

  // --- settings ------------------------------------------------------------

  private applySettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);

    if (patch.fftSize !== undefined) {
      this.analyzer?.setFftSize(patch.fftSize);
      // Existing columns keep their old resolution; only new ones change.
      // Nothing to invalidate, since stored dB values are untouched.
    }
    if (patch.pitchEnabled !== undefined) this.analyzer?.setPitchEnabled(patch.pitchEnabled);
    if (patch.colormap !== undefined) this.waterfall.setColormap(patch.colormap);
    if (patch.dbFloor !== undefined || patch.dbRange !== undefined) {
      this.waterfall.setDbRange(this.settings.dbFloor, this.settings.dbRange);
    }
    if (patch.timeZoom !== undefined && this.view) {
      this.view.pxPerCol = patch.timeZoom;
      this.waterfall.ensureSlots(this.view.visibleCols);
      this.waterfall.invalidate();
    }
    // freqLimit and a4 are read fresh each frame; nothing to do here.
  }

  /** Highest stored bin the current display limit reaches. */
  private get maxBin(): number {
    const t = Math.log(this.settings.freqLimit / F_MIN) / Math.log(F_MAX / F_MIN);
    return Math.min(BIN_COUNT - 1, Math.max(1, Math.round(t * (BIN_COUNT - 1))));
  }

  // --- playback and export -------------------------------------------------

  private togglePlay(): void {
    const { player, pcm, view } = this;
    if (!player || !pcm || !view) return;

    if (player.playing) {
      player.stop();
      this.controls.setPlayState(false);
      return;
    }

    const from = this.hasCursor ? view.colToSample(this.cursorCol) : pcm.earliestIndex;
    const start = Math.max(pcm.earliestIndex, from);
    const count = Math.min(pcm.writeIndex - start, MAX_PLAYBACK_SECONDS * this.sampleRate);
    if (count <= 0) return;

    player.play(pcm.readInt16(start, count), this.sampleRate, start);
    this.controls.setPlayState(true);
  }

  private exportWav(): void {
    const { pcm } = this;
    if (!pcm) return;
    const start = pcm.earliestIndex;
    const count = pcm.writeIndex - start;
    if (count <= 0) return;

    const blob = new Blob([encodeWav(pcm.readInt16(start, count), this.sampleRate)], {
      type: "audio/wav",
    });
    saveBlob(blob, `cascata-${Math.round(count / this.sampleRate)}s.wav`);
  }

  // --- input ---------------------------------------------------------------

  private bindPointer(): void {
    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointer = { id: e.pointerId, lastX: e.clientX, totalMovement: 0 };
    });

    this.canvas.addEventListener("pointermove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.lastX;
      p.lastX = e.clientX;
      p.totalMovement += Math.abs(dx);
      if (p.totalMovement > DRAG_THRESHOLD_PX) this.view?.panPixels(dx);
    });

    const endPointer = (e: PointerEvent) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      this.pointer = null;
      if (p.totalMovement <= DRAG_THRESHOLD_PX && this.view) {
        const rect = this.canvas.getBoundingClientRect();
        this.cursorCol = this.view.xToCol(e.clientX - rect.left);
        this.hasCursor = true;
      }
    };
    this.canvas.addEventListener("pointerup", endPointer);
    this.canvas.addEventListener("pointercancel", endPointer);
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
    });
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;

      const view = this.view;
      switch (e.key) {
        case " ":
          e.preventDefault();
          this.togglePlay();
          break;
        case "Escape":
          this.player?.stop();
          this.controls.setPlayState(false);
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          if (!view) return;
          e.preventDefault();
          const step = Math.max(1, Math.round(view.visibleCols / 10)) * (e.shiftKey ? 5 : 1);
          view.panColumns(e.key === "ArrowLeft" ? -step : step);
          break;
        }
      }
    });
  }

  private bindResize(): void {
    const observer = new ResizeObserver(() => this.resizeCanvas());
    observer.observe(this.canvas);
    window.addEventListener("resize", () => this.resizeCanvas());
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // Draw in CSS pixels; the backing store carries the device ratio.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.view) {
      this.view.widthPx = w;
      this.waterfall.ensureSlots(this.view.visibleCols);
    }
  }

  private bindVisibility(): void {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.capturing) void this.acquireWakeLock();
    });
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // Denied, unsupported, or the tab is hidden. Capture is unaffected.
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      // Already released.
    }
    this.wakeLock = null;
  }

  // --- draw loop -----------------------------------------------------------

  private tick(): void {
    const { view, columns, analyzer, pcm } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;

    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, w, h);

    if (!view || !columns || !analyzer || !pcm) return;

    analyzer.pump();
    view.setLatest(columns.writeIndex);
    view.setEarliest(columns.earliestIndex);
    this.controls.setFollowState(view.following);

    const player = this.player;
    if (player?.playing) {
      const playCol = view.sampleToCol(player.playheadSample);
      view.ensureVisible(playCol);
    }

    this.waterfall.ensureSlots(view.visibleCols);
    const startCol = view.startCol;
    const endCol = view.endCol;
    this.waterfall.sync(columns, startCol, endCol);
    this.waterfall.blit(this.ctx, { x: 0, y: 0, w, h }, startCol, endCol, this.maxBin);

    const geo: OverlayGeometry = {
      x: 0,
      y: 0,
      w,
      h,
      startCol,
      pxPerCol: view.pxPerCol,
      maxBin: this.maxBin,
      binCount: BIN_COUNT,
      fMin: F_MIN,
      fMax: F_MAX,
      a4: this.settings.a4,
      hop: HOP,
      sampleRate: this.sampleRate,
    };

    drawNoteRuler(this.ctx, geo);
    drawTimeAxis(this.ctx, geo);
    if (this.settings.pitchEnabled) drawPitchCurve(this.ctx, geo, columns);
    if (this.hasCursor) drawPlayCursor(this.ctx, geo, this.cursorCol);
    if (player?.playing) drawPlayhead(this.ctx, geo, view.sampleToCol(player.playheadSample));
    this.drawHover(geo, columns);

    this.updateStatus(view, columns);
  }

  private drawHover(geo: OverlayGeometry, columns: ColumnStore): void {
    const hover = this.hover;
    if (!hover || !this.view) return;

    const col = this.view.xToCol(hover.x);
    const freq = yToFreq(hover.y, geo);
    const view = columns.columnView(col);
    // The bin under the pointer, in the same log grid the column is stored on.
    const bin = Math.round(
      ((Math.log(freq) - Math.log(F_MIN)) / (Math.log(F_MAX) - Math.log(F_MIN))) * (BIN_COUNT - 1),
    );
    const db = view && bin >= 0 && bin < BIN_COUNT ? view[bin] : -127;

    drawCrosshair(
      this.ctx,
      geo,
      hover.x,
      hover.y,
      formatReadout({
        timeSec: this.view.colToTime(col),
        freq,
        db,
        a4: this.settings.a4,
      }),
    );
  }

  private updateStatus(view: ViewState, columns: ColumnStore): void {
    const seconds = view.colToTime(columns.writeIndex - columns.earliestIndex);
    const mode = this.capturing ? "Recording" : "Stopped";
    const follow = view.following ? "live" : "pinned";
    this.controls.setStatus(`${mode} · ${follow} · ${formatClock(seconds)} buffered`);
  }
}
