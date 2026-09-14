import { Analyzer } from "../analysis/analyzer";
import { BIN_COUNT, HOP } from "../config";
import type { Settings } from "../platform/settings";
import { ColumnStore } from "../store/columnStore";
import { PcmRing } from "../store/pcmRing";
import { ViewState } from "./viewState";

/**
 * One pane's audio, analysis, and view — everything about a pane that is not
 * a canvas or a button.
 *
 * Split out of Pane so it can be tested: PcmRing, ColumnStore, Analyzer, and
 * ViewState are all DOM-free, and the logic that binds them together (capacity
 * sizing, the analysis backlog, cursor placement, where an import starts) was
 * previously reachable only through a real canvas. Pane keeps the DOM and
 * drives one of these.
 */
export class PaneModel {
  private pcm: PcmRing | null = null;
  private columnStore: ColumnStore | null = null;
  private analyzer: Analyzer | null = null;
  private view: ViewState | null = null;

  private sampleRateHz = 0;
  private capacitySec = 0;
  private cursorColValue: number | null = null;

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

  get columns(): ColumnStore | null {
    return this.columnStore;
  }

  get cursorCol(): number | null {
    return this.cursorColValue;
  }

  get pcmRange(): { earliest: number; writeIndex: number } | null {
    return this.pcm ? { earliest: this.pcm.earliestIndex, writeIndex: this.pcm.writeIndex } : null;
  }

  /** Seconds of audio currently retained. */
  get durationSeconds(): number {
    const range = this.pcmRange;
    if (!range || this.sampleRateHz <= 0) return 0;
    return (range.writeIndex - range.earliest) / this.sampleRateHz;
  }

  /** Columns of analysis still owed, for splitting the frame budget and reporting progress. */
  get backlogColumns(): number {
    if (!this.analyzer) return 0;
    return Math.max(0, this.analyzer.producibleColumns - this.analyzer.cursor);
  }

  /** Fraction of available columns analysed, 0..1. Returns 1 when there is nothing to do. */
  get analysisProgress(): number {
    if (!this.analyzer) return 1;
    const target = this.analyzer.producibleColumns;
    if (target <= 0) return 1;
    return Math.min(1, (target - this.backlogColumns) / target);
  }

  build(sampleRate: number, capacitySeconds: number, settings: Settings, widthPx: number): void {
    this.sampleRateHz = sampleRate;
    this.capacitySec = capacitySeconds;

    const capacity = Math.ceil(capacitySeconds * sampleRate);
    this.pcm = new PcmRing(capacity);
    this.columnStore = new ColumnStore(Math.ceil(capacity / HOP), BIN_COUNT);
    this.analyzer = new Analyzer({ sampleRate, pcm: this.pcm, columns: this.columnStore });
    this.analyzer.setFftSize(settings.fftSize);
    this.analyzer.setPitchEnabled(settings.pitchEnabled);

    this.view = new ViewState({ sampleRate });
    this.view.pxPerCol = settings.timeZoom;
    this.view.widthPx = widthPx;
    this.cursorColValue = null;
  }

  writeSamples(chunk: Float32Array): void {
    this.pcm?.write(chunk);
  }

  fillSamples(startSample: number, channel: Float32Array): void {
    this.pcm?.read(startSample, channel);
  }

  readInt16(startSample: number, count: number): Int16Array | null {
    return this.pcm?.readInt16(startSample, count) ?? null;
  }

  /** Advances analysis for at most `budgetMs`. Returns columns produced. */
  pump(budgetMs: number, now: () => number = () => performance.now()): number {
    const analyzer = this.analyzer;
    if (!analyzer) return 0;
    const deadline = now() + budgetMs;
    let produced = 0;
    do {
      const n = analyzer.pump(64);
      if (n === 0) break;
      produced += n;
    } while (now() < deadline);
    return produced;
  }

  clear(): void {
    this.pcm?.clear();
    this.analyzer?.reset();
    this.cursorColValue = null;
    this.view?.follow();
  }

  /**
   * Pins the view to the very start, for an import that should be read from
   * its beginning rather than followed at the live edge.
   *
   * The view has to learn the new range first: panning against a still-empty
   * view clamps to -visibleCols and shows a screen of blank.
   */
  showFromStart(latestCol: number): void {
    if (!this.view) return;
    this.view.setEarliest(0);
    this.view.setLatest(latestCol);
    this.view.panColumns(-Number.MAX_SAFE_INTEGER);
    this.cursorColValue = 0;
  }

  showCursorAt(col: number): void {
    this.cursorColValue = Math.max(0, Math.round(col));
  }

  clearCursor(): void {
    this.cursorColValue = null;
  }

  /** Routes the settings that change analysis rather than presentation. */
  applyAnalysisSettings(patch: Partial<Settings>): void {
    if (patch.fftSize !== undefined) this.analyzer?.setFftSize(patch.fftSize);
    if (patch.pitchEnabled !== undefined) this.analyzer?.setPitchEnabled(patch.pitchEnabled);
    if (patch.timeZoom !== undefined && this.view) this.view.pxPerCol = patch.timeZoom;
  }

  /** Lets the view track the data. Called once a frame before drawing. */
  syncViewBounds(): void {
    if (!this.view || !this.columnStore) return;
    this.view.setLatest(this.columnStore.writeIndex);
    this.view.setEarliest(this.columnStore.earliestIndex);
  }

  setViewWidth(widthPx: number): void {
    if (this.view) this.view.widthPx = widthPx;
  }
}
