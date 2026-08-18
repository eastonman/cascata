import { expect, test } from "bun:test";
import { Analyzer } from "./analyzer";
import { PcmRing } from "../store/pcmRing";
import { ColumnStore } from "../store/columnStore";
import { LogBinMap } from "../dsp/logBins";
import { BIN_COUNT, HOP } from "../config";

const SR = 48000;

function setup() {
  const pcm = new PcmRing(SR * 10);
  const columns = new ColumnStore(Math.ceil((SR * 10) / HOP), BIN_COUNT);
  return { pcm, columns, analyzer: new Analyzer({ sampleRate: SR, pcm, columns }) };
}

function tone(n: number, freq: number, amp = 0.5): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

test("produces no columns until enough lookahead exists", () => {
  const { pcm, analyzer } = setup();
  pcm.write(new Float32Array(HOP));
  expect(analyzer.pump()).toBe(0);
  expect(analyzer.cursor).toBe(0);
});

test("advances one column per hop on the fixed time grid", () => {
  const { pcm, analyzer } = setup();
  pcm.write(tone(SR, 440));
  analyzer.pump(100000);
  const lag = analyzer.fftSize / 2;
  expect(analyzer.cursor).toBe(Math.floor((SR - lag) / HOP) + 1);
});

test("column content locates the tone at the right log bin", () => {
  const { pcm, columns, analyzer } = setup();
  pcm.write(tone(SR, 440));
  analyzer.pump(100000);

  const map = new LogBinMap(analyzer.fftSize, SR);
  const mid = Math.floor(analyzer.cursor / 2);
  const out = new Int8Array(BIN_COUNT);
  expect(columns.readColumn(mid, out)).toBe(true);

  let peak = 0;
  for (let i = 1; i < out.length; i++) if (out[i] > out[peak]) peak = i;
  // Within one FFT bin or one log bin, whichever is coarser at 440 Hz.
  const fftBinHz = SR / analyzer.fftSize;
  const logBinHz = map.binToFreq(map.freqToBin(440) + 0.5) - map.binToFreq(map.freqToBin(440) - 0.5);
  expect(Math.abs(map.binToFreq(peak) - 440)).toBeLessThan(Math.max(fftBinHz, logBinHz));
});

test("computes YIN f0 when pitch is enabled", () => {
  const { pcm, columns, analyzer } = setup();
  analyzer.setPitchEnabled(true);
  pcm.write(tone(SR, 220));
  analyzer.pump(100000);
  const mid = Math.floor(analyzer.cursor / 2);
  expect(Math.abs(columns.getF0(mid) - 220)).toBeLessThan(2);
});

test("stores -1 for f0 when pitch is disabled", () => {
  const { pcm, columns, analyzer } = setup();
  analyzer.setPitchEnabled(false);
  pcm.write(tone(SR, 220));
  analyzer.pump(100000);
  expect(columns.getF0(Math.floor(analyzer.cursor / 2))).toBe(-1);
});

test("pump is bounded by maxColumns and resumes where it stopped", () => {
  const { pcm, analyzer } = setup();
  pcm.write(tone(SR, 440));
  expect(analyzer.pump(5)).toBe(5);
  expect(analyzer.cursor).toBe(5);
  expect(analyzer.pump(5)).toBe(5);
  expect(analyzer.cursor).toBe(10);
});

test("changing FFT size does not rewind the cursor or shift the grid", () => {
  // With 1 s of PCM the lookahead gate allows columns up to 44 at fftSize 4096
  // and up to 42 at 8192, so both pumps stay inside the producible range.
  const { pcm, analyzer } = setup();
  pcm.write(tone(SR, 440));
  expect(analyzer.pump(20)).toBe(20);
  const before = analyzer.cursor;
  expect(before).toBe(20);
  analyzer.setFftSize(8192);
  expect(analyzer.fftSize).toBe(8192);
  expect(analyzer.cursor).toBe(before);
  expect(analyzer.pump(20)).toBe(20);
  expect(analyzer.cursor).toBe(before + 20);
});

test("the time grid does not shift when the window length changes", () => {
  // Same hop, same column -> same centre sample, regardless of window length.
  // A tone burst starting at a known sample must appear at the same column.
  const burstStart = 20 * HOP;
  const build = () => {
    const s = setup();
    const buf = new Float32Array(SR);
    for (let i = burstStart; i < SR; i++) {
      buf[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
    }
    s.pcm.write(buf);
    return s;
  };

  const firstLoudColumn = (s: ReturnType<typeof setup>) => {
    s.analyzer.pump(100000);
    const out = new Int8Array(BIN_COUNT);
    for (let c = 0; c < s.analyzer.cursor; c++) {
      if (!s.columns.readColumn(c, out)) continue;
      let peak = -128;
      for (const v of out) if (v > peak) peak = v;
      if (peak > -30) return c;
    }
    return -1;
  };

  const a = build();
  const b = build();
  b.analyzer.setFftSize(8192);

  // Both must straddle the burst onset at column 20; a longer window simply
  // reaches further back, so it lights up earlier, but the grid is unmoved.
  expect(firstLoudColumn(a)).toBeGreaterThan(0);
  expect(firstLoudColumn(b)).toBeGreaterThan(0);
  expect(firstLoudColumn(a)).toBeLessThanOrEqual(20);
  expect(firstLoudColumn(b)).toBeLessThan(firstLoudColumn(a));
});

test("reset returns the cursor to zero", () => {
  const { pcm, analyzer } = setup();
  pcm.write(tone(SR, 440));
  analyzer.pump(20);
  analyzer.reset();
  expect(analyzer.cursor).toBe(0);
});

test("setFftSize rejects unsupported sizes", () => {
  const { analyzer } = setup();
  // @ts-expect-error deliberately passing an unsupported size
  expect(() => analyzer.setFftSize(1024)).toThrow();
});

test("an impulse at sample K*HOP peaks at exactly column K", () => {
  // Pins the absolute window centring, which no relative test can: shifting the
  // whole grid by half a window (left-aligning the STFT frame) puts the entire
  // spectrogram 42.7 ms out of step with the audio and the time axis, and every
  // other test in this file still passes.
  const { pcm, columns, analyzer } = setup();
  const K = 30;
  const buf = new Float32Array(SR);
  buf[K * HOP] = 1;
  pcm.write(buf);
  analyzer.pump(100000);

  const out = new Int8Array(BIN_COUNT);
  let bestCol = -1;
  let bestLevel = -Infinity;
  for (let c = 0; c < analyzer.cursor; c++) {
    if (!columns.readColumn(c, out)) continue;
    let peak = -128;
    for (const v of out) if (v > peak) peak = v;
    if (peak > bestLevel) {
      bestLevel = peak;
      bestCol = c;
    }
  }
  expect(bestCol).toBe(K);
});

test("the YIN frame is centred too, not left-aligned", () => {
  // A tone confined to [K*HOP - YIN_WINDOW/2, K*HOP + YIN_WINDOW/2) is only
  // detectable at column K if the YIN frame is centred on K*HOP.
  const { pcm, analyzer, columns } = setup();
  analyzer.setPitchEnabled(true);
  const K = 40;
  const half = 512;
  const buf = new Float32Array(SR);
  for (let i = K * HOP - half; i < K * HOP + half; i++) {
    buf[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  pcm.write(buf);
  analyzer.pump(100000);
  expect(Math.abs(columns.getF0(K) - 220)).toBeLessThan(5);
});

test("the cursor skips forward past PCM that was already evicted", () => {
  // A hidden tab pauses rAF while the capture worklet keeps writing. On return
  // the analyzer must not grind through columns whose samples are long gone.
  const pcm = new PcmRing(SR); // 1 s ring
  const columns = new ColumnStore(Math.ceil(SR / HOP), BIN_COUNT);
  const analyzer = new Analyzer({ sampleRate: SR, pcm, columns });

  pcm.write(tone(SR * 5, 440)); // 5 s written into a 1 s ring
  expect(pcm.earliestIndex).toBe(SR * 4);

  const produced = analyzer.pump(100000);
  expect(analyzer.cursor).toBeGreaterThan((SR * 4) / HOP);
  expect(produced).toBeLessThan(Math.ceil(SR / HOP) + 2);

  // Everything it actually analysed came from PCM that was present. Columns
  // before that are the gap fill for the skipped span and read as empty.
  const out = new Int8Array(BIN_COUNT);
  for (let c = columns.writeIndex - produced; c < columns.writeIndex; c++) {
    expect(columns.readColumn(c, out)).toBe(true);
    let peak = -128;
    for (const v of out) if (v > peak) peak = v;
    expect(peak).toBeGreaterThan(-60);
  }
});
