import { expect, test } from "bun:test";
import { HOP } from "../config";
import { DEFAULT_SETTINGS } from "../platform/settings";
import { PaneModel } from "./paneModel";

const SR = 48000;
const WIDTH = 1000;

function tone(n: number, freq = 440, amp = 0.5): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

function built(capacitySeconds = 10): PaneModel {
  const m = new PaneModel();
  m.build(SR, capacitySeconds, DEFAULT_SETTINGS, WIDTH);
  return m;
}

test("an unbuilt model reports nothing rather than throwing", () => {
  const m = new PaneModel();
  expect(m.hasData).toBe(false);
  expect(m.pcmRange).toBeNull();
  expect(m.viewState).toBeNull();
  expect(m.durationSeconds).toBe(0);
  expect(m.backlogColumns).toBe(0);
  expect(m.pump(8)).toBe(0);
  expect(() => m.clear()).not.toThrow();
  expect(() => m.writeSamples(tone(128))).not.toThrow();
});

test("build sizes the stores from the capacity it is given", () => {
  const m = built(4);
  m.writeSamples(tone(SR * 10)); // ten seconds into a four-second ring
  const range = m.pcmRange!;
  expect(range.writeIndex - range.earliest).toBe(4 * SR);
  expect(m.durationSeconds).toBeCloseTo(4, 6);
});

test("writing then pumping produces columns and drains the backlog", () => {
  const m = built();
  m.writeSamples(tone(SR));
  const owed = m.backlogColumns;
  expect(owed).toBeGreaterThan(40);
  expect(m.analysisProgress).toBeLessThan(1);

  // A generous budget so the loop is bounded by data, not by the clock.
  m.pump(1000);
  expect(m.backlogColumns).toBeLessThan(owed);
  expect(m.columns!.writeIndex).toBeGreaterThan(0);
});

test("pump stops at its budget rather than running to completion", () => {
  const m = built();
  m.writeSamples(tone(SR * 5));
  // A fake clock: the first read starts the budget, the second is already past.
  let calls = 0;
  const now = () => (calls++ === 0 ? 0 : 1000);
  const produced = m.pump(8, now);
  expect(produced).toBe(64); // exactly one batch
  expect(m.backlogColumns).toBeGreaterThan(0);
});

test("analysisProgress reaches 1 once the backlog is gone", () => {
  const m = built();
  m.writeSamples(tone(SR));
  m.pump(1000);
  expect(m.backlogColumns).toBe(0);
  expect(m.analysisProgress).toBe(1);
});

test("an empty model is reported as fully analysed, not as 0%", () => {
  expect(built().analysisProgress).toBe(1);
});

test("clear empties the audio, the columns, and the cursor", () => {
  const m = built();
  m.writeSamples(tone(SR));
  m.pump(1000);
  m.showCursorAt(12);

  m.clear();
  expect(m.hasData).toBe(false);
  expect(m.durationSeconds).toBe(0);
  expect(m.cursorCol).toBeNull();
  expect(m.columns!.writeIndex).toBe(0);
  expect(m.backlogColumns).toBe(0);
});

test("showFromStart pins a file longer than the viewport to column zero", () => {
  // 25 s is 1172 columns against a 1000-column viewport, so column 0 is
  // reachable. Not -visibleCols, which is what panning against an unseeded
  // view produces and which renders as a screen of blank.
  const m = built(30);
  m.writeSamples(tone(SR * 25));
  m.showFromStart(Math.ceil((SR * 25) / HOP));

  expect(m.viewState!.startCol).toBe(0);
  expect(m.viewState!.following).toBe(false);
  expect(m.cursorCol).toBe(0);
});

test("a file shorter than the viewport sits at the right edge, not the left", () => {
  // Inherited from the recording semantics in ViewState: data enters at the
  // right and scrolls left, so a buffer narrower than the viewport can never
  // start at column 0. For a completed import that reads oddly -- the trace
  // hugs the right with blank to its left -- but changing it means changing
  // how a fresh recording is positioned too, so it is recorded here rather
  // than quietly special-cased.
  const m = built();
  m.writeSamples(tone(SR * 5));
  m.showFromStart(Math.ceil((SR * 5) / HOP));

  const view = m.viewState!;
  expect(view.startCol).toBeLessThan(0);
  expect(view.endCol).toBe(Math.ceil((SR * 5) / HOP));
  expect(m.cursorCol).toBe(0);
});

test("showCursorAt clamps and rounds", () => {
  const m = built();
  m.showCursorAt(-5);
  expect(m.cursorCol).toBe(0);
  m.showCursorAt(7.6);
  expect(m.cursorCol).toBe(8);
  m.clearCursor();
  expect(m.cursorCol).toBeNull();
});

test("build resets the cursor, so an import does not inherit one", () => {
  const m = built();
  m.showCursorAt(42);
  m.build(SR, 10, DEFAULT_SETTINGS, WIDTH);
  expect(m.cursorCol).toBeNull();
});

test("applyAnalysisSettings routes zoom to the view", () => {
  const m = built();
  m.applyAnalysisSettings({ timeZoom: 4 });
  expect(m.viewState!.pxPerCol).toBe(4);
});

test("applyAnalysisSettings ignores presentation-only settings", () => {
  const m = built();
  const before = m.viewState!.pxPerCol;
  m.applyAnalysisSettings({ colormap: "viridis", dbFloor: -100, freqLimit: 8000 });
  expect(m.viewState!.pxPerCol).toBe(before);
});

test("turning pitch off records columns as not-computed", () => {
  const m = built();
  m.applyAnalysisSettings({ pitchEnabled: false });
  m.writeSamples(tone(SR, 220));
  m.pump(1000);
  expect(m.columns!.getF0(10)).toBe(-1);
});

test("syncViewBounds lets the view track the analysed range", () => {
  const m = built();
  m.writeSamples(tone(SR));
  m.pump(1000);
  m.syncViewBounds();
  expect(m.viewState!.endCol).toBe(m.columns!.writeIndex);
});
