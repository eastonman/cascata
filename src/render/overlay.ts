import { describeFreq, midiToFreq, noteName } from "../dsp/notes";
import { ColumnStore, F0_SILENT, F0_UNCOMPUTED } from "../store/columnStore";

/** The part of the geometry that frequency-axis maths needs. */
export interface FreqAxis {
  /** Plot height in CSS pixels. */
  h: number;
  binCount: number;
  /** Highest bin currently displayed; the display frequency limit. */
  maxBin: number;
  fMin: number;
  fMax: number;
}

export interface OverlayGeometry extends FreqAxis {
  x: number;
  y: number;
  w: number;
  /** Absolute column index at the left edge. */
  startCol: number;
  pxPerCol: number;
  a4: number;
  hop: number;
  sampleRate: number;
}

const RULER_COLOR = "rgba(255,255,255,0.16)";
const RULER_LABEL_COLOR = "rgba(255,255,255,0.55)";
const A4_COLOR = "rgba(120,200,255,0.55)";
const PITCH_COLOR = "rgba(90,255,170,0.95)";
const CURSOR_COLOR = "rgba(255,255,255,0.75)";
const PLAYHEAD_COLOR = "rgba(255,120,120,0.95)";
const CROSSHAIR_COLOR = "rgba(255,255,255,0.5)";
const LABEL_FONT = "11px ui-monospace, SFMono-Regular, Menlo, monospace";

/** Fractional log-bin position of a frequency. */
function freqToBin(freq: number, g: FreqAxis): number {
  return ((Math.log(freq) - Math.log(g.fMin)) / (Math.log(g.fMax) - Math.log(g.fMin))) * (g.binCount - 1);
}

/** Canvas y of a frequency, measured from the top of the plot. */
export function freqToY(freq: number, g: FreqAxis): number {
  return g.h * (1 - freqToBin(freq, g) / g.maxBin);
}

export function yToFreq(y: number, g: FreqAxis): number {
  const bin = (1 - y / g.h) * g.maxBin;
  const logMin = Math.log(g.fMin);
  return Math.exp(logMin + ((Math.log(g.fMax) - logMin) * bin) / (g.binCount - 1));
}

export function colToX(col: number, g: OverlayGeometry): number {
  return g.x + (col - g.startCol) * g.pxPerCol;
}

export function formatClock(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}

export function formatReadout(opts: {
  timeSec: number;
  freq: number;
  db: number;
  a4: number;
}): string {
  const parts = [formatClock(opts.timeSec)];
  const note = describeFreq(opts.freq, opts.a4);
  if (note) {
    const cents = Math.round(note.cents);
    const sign = cents >= 0 ? "+" : "";
    parts.push(`${opts.freq.toFixed(1)} Hz`, `${note.name} ${sign}${cents}¢`);
  }
  parts.push(`${Math.round(opts.db)} dB`);
  return parts.join(" · ");
}

/** C1-C9 gridlines with labels, plus a brighter A4 reference that follows calibration. */
export function drawNoteRuler(ctx: CanvasRenderingContext2D, g: OverlayGeometry): void {
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 1;

  for (let octave = 1; octave <= 9; octave++) {
    const midi = 12 * (octave + 1); // C of that octave
    const freq = midiToFreq(midi, g.a4);
    if (freq < g.fMin || freq > g.fMax) continue;
    const y = g.y + freqToY(freq, g);
    if (y < g.y || y > g.y + g.h) continue;

    ctx.strokeStyle = RULER_COLOR;
    ctx.beginPath();
    // Half-pixel offset keeps a 1px line crisp instead of blurring across two rows.
    ctx.moveTo(g.x, Math.round(y) + 0.5);
    ctx.lineTo(g.x + g.w, Math.round(y) + 0.5);
    ctx.stroke();

    ctx.fillStyle = RULER_LABEL_COLOR;
    ctx.fillText(noteName(midi), g.x + 4, y - 2);
  }

  const a4y = g.y + freqToY(g.a4, g);
  if (a4y >= g.y && a4y <= g.y + g.h) {
    ctx.strokeStyle = A4_COLOR;
    ctx.beginPath();
    ctx.moveTo(g.x, Math.round(a4y) + 0.5);
    ctx.lineTo(g.x + g.w, Math.round(a4y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = A4_COLOR;
    ctx.fillText(`A4 ${g.a4}`, g.x + 4, a4y - 2);
  }

  ctx.restore();
}

/** Time ticks, spaced so labels never crowd below ~60 px apart. */
export function drawTimeAxis(ctx: CanvasRenderingContext2D, g: OverlayGeometry): void {
  const colsPerSecond = g.sampleRate / g.hop;
  const pxPerSecond = colsPerSecond * g.pxPerCol;
  const step = [1, 2, 5, 10, 30, 60].find((s) => s * pxPerSecond >= 60) ?? 60;

  const startSec = (g.startCol / colsPerSecond);
  const endSec = startSec + g.w / pxPerSecond;

  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "top";
  ctx.strokeStyle = RULER_COLOR;
  ctx.fillStyle = RULER_LABEL_COLOR;
  ctx.lineWidth = 1;

  for (let t = Math.ceil(startSec / step) * step; t <= endSec; t += step) {
    const x = g.x + (t - startSec) * pxPerSecond;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, g.y + g.h - 8);
    ctx.lineTo(Math.round(x) + 0.5, g.y + g.h);
    ctx.stroke();
    ctx.fillText(formatClock(t), x + 3, g.y + g.h - 16);
  }

  ctx.restore();
}

/**
 * YIN curve. The line breaks wherever f0 is silent, uncomputed, or out of
 * range — DESIGN.md §5.2 keeps octave jumps visible rather than bridging them,
 * so a break here must read as a break, not as a steep slope.
 */
export function drawPitchCurve(
  ctx: CanvasRenderingContext2D,
  g: OverlayGeometry,
  store: ColumnStore,
): void {
  const endCol = g.startCol + Math.ceil(g.w / g.pxPerCol);

  ctx.save();
  ctx.strokeStyle = PITCH_COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();

  let pen = false;
  for (let col = Math.max(0, Math.floor(g.startCol)); col <= endCol; col++) {
    const f0 = store.getF0(col);
    if (f0 === F0_SILENT || f0 === F0_UNCOMPUTED || f0 < g.fMin || f0 > g.fMax) {
      pen = false;
      continue;
    }
    const y = g.y + freqToY(f0, g);
    if (y < g.y || y > g.y + g.h) {
      pen = false;
      continue;
    }
    const x = colToX(col, g);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }

  ctx.stroke();
  ctx.restore();
}

function verticalLine(
  ctx: CanvasRenderingContext2D,
  g: OverlayGeometry,
  col: number,
  color: string,
  dash: number[],
): void {
  const x = colToX(col, g);
  if (x < g.x || x > g.x + g.w) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, g.y);
  ctx.lineTo(Math.round(x) + 0.5, g.y + g.h);
  ctx.stroke();
  ctx.restore();
}

/** Dashed: where playback would start. */
export function drawPlayCursor(ctx: CanvasRenderingContext2D, g: OverlayGeometry, col: number): void {
  verticalLine(ctx, g, col, CURSOR_COLOR, [4, 4]);
}

/** Solid: where playback currently is. */
export function drawPlayhead(ctx: CanvasRenderingContext2D, g: OverlayGeometry, col: number): void {
  verticalLine(ctx, g, col, PLAYHEAD_COLOR, []);
}

export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  g: OverlayGeometry,
  px: number,
  py: number,
  readout: string,
): void {
  ctx.save();
  ctx.strokeStyle = CROSSHAIR_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(g.x, Math.round(py) + 0.5);
  ctx.lineTo(g.x + g.w, Math.round(py) + 0.5);
  ctx.moveTo(Math.round(px) + 0.5, g.y);
  ctx.lineTo(Math.round(px) + 0.5, g.y + g.h);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = LABEL_FONT;
  ctx.textBaseline = "top";
  const padding = 4;
  const width = ctx.measureText(readout).width + padding * 2;
  const height = 18;
  // Flip the box to the other side of the cursor near an edge so it stays visible.
  let bx = px + 8;
  if (bx + width > g.x + g.w) bx = px - 8 - width;
  let by = py + 8;
  if (by + height > g.y + g.h) by = py - 8 - height;

  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(bx, by, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(readout, bx + padding, by + padding);
  ctx.restore();
}
