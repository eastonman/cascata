import { expect, test } from "bun:test";
import { ViewState } from "./viewState";
import { HOP } from "../config";

const SR = 48000;

function view() {
  const v = new ViewState({ sampleRate: SR });
  v.widthPx = 1000;
  v.pxPerCol = 1;
  v.setEarliest(0);
  v.setLatest(5000);
  return v;
}

test("following pins the right edge to the newest column", () => {
  const v = view();
  expect(v.following).toBe(true);
  expect(v.endCol).toBe(5000);
  expect(v.startCol).toBe(4000);
  v.setLatest(5100);
  expect(v.endCol).toBe(5100);
  expect(v.startCol).toBe(4100);
});

test("dragging right leaves follow mode and moves back in time", () => {
  const v = view();
  v.panPixels(200);
  expect(v.following).toBe(false);
  expect(v.startCol).toBe(3800);
  v.setLatest(6000);
  expect(v.startCol).toBe(3800);
});

test("dragging left from the live edge stays in follow mode", () => {
  const v = view();
  v.panPixels(-200); // no newer data to reveal
  expect(v.following).toBe(true);
  expect(v.endCol).toBe(5000);
});

test("panning clamps at the earliest retained column", () => {
  const v = view();
  v.setEarliest(3000);
  v.panColumns(-9999);
  expect(v.startCol).toBe(3000);
});

test("panning past the newest data re-enters follow mode", () => {
  const v = view();
  v.panColumns(-500);
  expect(v.following).toBe(false);
  v.panColumns(9999);
  expect(v.following).toBe(true);
  expect(v.endCol).toBe(5000);
});

test("follow() restores right-edge tracking", () => {
  const v = view();
  v.panColumns(-500);
  v.follow();
  expect(v.following).toBe(true);
  expect(v.endCol).toBe(5000);
});

test("zoom changes the visible span and keeps the right edge while following", () => {
  const v = view();
  expect(v.visibleCols).toBe(1000);
  v.pxPerCol = 4;
  expect(v.visibleCols).toBe(250);
  expect(v.endCol).toBe(5000);
  expect(v.startCol).toBe(4750);
});

test("zoom keeps startCol anchored while pinned", () => {
  const v = view();
  v.panColumns(-1000);
  expect(v.startCol).toBe(3000);
  v.pxPerCol = 2;
  expect(v.startCol).toBe(3000);
  expect(v.visibleCols).toBe(500);
});

test("x and column conversions are inverse", () => {
  const v = view();
  v.pxPerCol = 2;
  const col = v.startCol + 37;
  expect(v.xToCol(v.colToX(col))).toBe(col);
});

test("column and time conversions follow the hop grid", () => {
  const v = view();
  expect(v.colToTime(0)).toBe(0);
  expect(v.colToTime(SR / HOP)).toBeCloseTo(1, 6);
  expect(v.timeToCol(1)).toBe(Math.round(SR / HOP));
  expect(v.colToSample(10)).toBe(10 * HOP);
  expect(v.sampleToCol(10 * HOP)).toBe(10);
});

test("ensureVisible scrolls a pinned view minimally", () => {
  const v = view();
  v.panColumns(-1000);
  expect(v.startCol).toBe(3000);
  v.ensureVisible(4200);
  expect(v.startCol).toBe(3201);
  expect(v.following).toBe(false);
  v.ensureVisible(3500);
  expect(v.startCol).toBe(3201);
});

test("ensureVisible scrolls backwards for a column before the view", () => {
  const v = view();
  v.panColumns(-500);
  expect(v.startCol).toBe(3500);
  v.ensureVisible(3200);
  expect(v.startCol).toBe(3200);
});

test("a fresh recording sits at the right edge with blank space to its left", () => {
  // Data enters at the right and scrolls left, so with less than a screenful
  // recorded, startCol runs negative and the left of the plot is empty.
  const v = new ViewState({ sampleRate: SR });
  v.widthPx = 1000;
  v.pxPerCol = 1;
  v.setEarliest(0);
  v.setLatest(300);
  expect(v.startCol).toBe(-700);
  expect(v.endCol).toBe(300);
});

test("panning cannot leave the retained range", () => {
  const v = view();
  v.setEarliest(3000);
  v.panColumns(-100);
  expect(v.startCol).toBe(3900);
  v.panColumns(-2000);
  expect(v.startCol).toBe(3000);
});
