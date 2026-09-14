import { expect, test } from "bun:test";
import { HOP } from "../config";
import { equivalentSample, linkOffset, mirrorView } from "./paneLink";
import { ViewState } from "./viewState";

const SR = 48000;

function pane(latest: number, earliest = 0): ViewState {
  const v = new ViewState({ sampleRate: SR });
  v.widthPx = 1000;
  v.pxPerCol = 1;
  v.setEarliest(earliest);
  v.setLatest(latest);
  return v;
}

/** Two pinned panes at known, different positions. */
function pinnedPair() {
  const a = pane(5000);
  const b = pane(5000);
  a.panColumns(-1000); // startCol 3000
  b.panColumns(-500); // startCol 3500
  return { a, b };
}

test("linking does not move either pane", () => {
  const { a, b } = pinnedPair();
  const before = { a: a.startCol, b: b.startCol };

  const offset = linkOffset(a, b);
  expect(offset).toBe(500);

  const correction = mirrorView(a, b, offset);
  expect(correction).toBe(0);
  expect(a.startCol).toBe(before.a);
  expect(b.startCol).toBe(before.b);
});

test("panning the master moves the follower by the same delta", () => {
  const { a, b } = pinnedPair();
  const offset = linkOffset(a, b);

  a.panColumns(-200);
  mirrorView(a, b, offset);

  expect(a.startCol).toBe(2800);
  expect(b.startCol).toBe(3300);
  expect(b.startCol - a.startCol).toBe(offset);
});

test("zooming the master applies the same scale to the follower", () => {
  const { a, b } = pinnedPair();
  const offset = linkOffset(a, b);

  a.pxPerCol = 4;
  mirrorView(a, b, offset);

  expect(b.pxPerCol).toBe(4);
  expect(b.visibleCols).toBe(a.visibleCols);
  expect(b.startCol - a.startCol).toBe(offset);
});

test("a follower that hits its own bound reports the correction needed", () => {
  // B retains less history than A, so it runs out first.
  const { a, b } = pinnedPair();
  const offset = linkOffset(a, b);
  b.setEarliest(3400);

  a.panColumns(-200); // wants B at 3300, which B cannot reach
  const correction = mirrorView(a, b, offset);

  expect(correction).toBe(100);
  expect(b.startCol).toBe(3400);
});

test("applying the correction keeps the two consistent", () => {
  const { a, b } = pinnedPair();
  const offset = linkOffset(a, b);
  b.setEarliest(3400);

  a.panColumns(-200);
  const correction = mirrorView(a, b, offset);
  a.panColumns(correction);

  // Without the correction A would sit at 2800 while B was stuck at 3400,
  // silently 100 columns out of step with what "linked" claims.
  expect(b.startCol - a.startCol).toBe(offset);
});

test("mirroring is symmetric: either pane can drive", () => {
  const { a, b } = pinnedPair();
  const offset = linkOffset(a, b);

  b.panColumns(-300);
  const correction = mirrorView(b, a, -offset);
  a.panColumns(correction);

  expect(b.startCol - a.startCol).toBe(offset);
});

test("equivalentSample round-trips between panes", () => {
  const offset = 500;
  const inA = 10 * HOP;
  const inB = equivalentSample(inA, 1, offset, true);
  expect(inB).toBe(inA + offset * HOP);
  expect(equivalentSample(inB, -1, offset, true)).toBe(inA);
});

test("an unlinked switch keeps the same absolute sample", () => {
  const s = 12345;
  expect(equivalentSample(s, 1, 500, false)).toBe(s);
  expect(equivalentSample(s, -1, 500, false)).toBe(s);
});

test("a zero offset makes linked and unlinked identical", () => {
  const s = 98765;
  expect(equivalentSample(s, 1, 0, true)).toBe(equivalentSample(s, 1, 0, false));
});

test("equivalentSample never returns a negative sample index", () => {
  // Switching near the start of B, where the matching moment in A is before
  // the recording began.
  expect(equivalentSample(100, -1, 500, true)).toBe(0);
});
