import { expect, test } from "bun:test";
import { ColumnStore } from "./columnStore";

function col(fill: number, n = 4): Int8Array {
  return new Int8Array(n).fill(fill);
}

test("tracks absolute column indices and eviction", () => {
  const cs = new ColumnStore(3, 4);
  expect(cs.writeIndex).toBe(0);
  cs.push(0, col(-10), 220);
  cs.push(1, col(-20), 0);
  cs.push(2, col(-30), -1);
  expect(cs.writeIndex).toBe(3);
  expect(cs.earliestIndex).toBe(0);
  cs.push(3, col(-40), 440);
  expect(cs.writeIndex).toBe(4);
  expect(cs.earliestIndex).toBe(1);
  expect(cs.has(0)).toBe(false);
  expect(cs.has(1)).toBe(true);
  expect(cs.has(4)).toBe(false);
});

test("reads back column data and f0", () => {
  const cs = new ColumnStore(4, 4);
  cs.push(0, Int8Array.from([-1, -2, -3, -4]), 261.6);
  const out = new Int8Array(4);
  expect(cs.readColumn(0, out)).toBe(true);
  expect(Array.from(out)).toEqual([-1, -2, -3, -4]);
  expect(cs.getF0(0)).toBeCloseTo(261.6, 3);
});

test("readColumn returns false for evicted or future columns", () => {
  const cs = new ColumnStore(2, 4);
  cs.push(0, col(-10), 0);
  cs.push(1, col(-20), 0);
  cs.push(2, col(-30), 0);
  const out = new Int8Array(4);
  expect(cs.readColumn(0, out)).toBe(false);
  expect(cs.readColumn(9, out)).toBe(false);
  expect(cs.readColumn(1, out)).toBe(true);
});

test("columnView aliases stored data without copying", () => {
  const cs = new ColumnStore(2, 4);
  cs.push(0, Int8Array.from([-5, -6, -7, -8]), 0);
  const view = cs.columnView(0)!;
  expect(view.length).toBe(4);
  expect(Array.from(view)).toEqual([-5, -6, -7, -8]);
  expect(cs.columnView(5)).toBeNull();
});

test("f0 distinguishes silence (0) from not-computed (-1)", () => {
  const cs = new ColumnStore(4, 4);
  cs.push(0, col(-10), 0);
  cs.push(1, col(-10), -1);
  expect(cs.getF0(0)).toBe(0);
  expect(cs.getF0(1)).toBe(-1);
  cs.setF0(1, 330);
  expect(cs.getF0(1)).toBeCloseTo(330, 3);
});

test("getF0 returns -1 for out-of-range columns", () => {
  const cs = new ColumnStore(2, 4);
  cs.push(0, col(-10), 440);
  expect(cs.getF0(7)).toBe(-1);
});

test("setF0 ignores out-of-range columns", () => {
  const cs = new ColumnStore(2, 4);
  cs.push(0, col(-10), 440);
  expect(() => cs.setF0(7, 100)).not.toThrow();
  expect(cs.getF0(7)).toBe(-1);
});

test("push rejects wrongly sized columns", () => {
  const cs = new ColumnStore(2, 4);
  expect(() => cs.push(0, new Int8Array(3), 0)).toThrow();
});

test("clear resets the store", () => {
  const cs = new ColumnStore(2, 4);
  cs.push(0, col(-10), 100);
  cs.clear();
  expect(cs.writeIndex).toBe(0);
  expect(cs.has(0)).toBe(false);
});

test("push rejects rewriting an already-written column", () => {
  const cs = new ColumnStore(4, 4);
  cs.push(0, col(-10), 0);
  cs.push(1, col(-20), 0);
  expect(() => cs.push(1, col(-30), 0)).toThrow();
  expect(() => cs.push(0, col(-30), 0)).toThrow();
});

test("a forward gap is filled with the floor and marked not-computed", () => {
  // The analyzer skips columns whose PCM was evicted while the tab was hidden.
  // Those positions must read as absent, not as stale data from 4 columns ago.
  const cs = new ColumnStore(8, 4);
  cs.push(0, col(-10), 220);
  cs.push(4, col(-20), 330);
  expect(cs.writeIndex).toBe(5);

  const out = new Int8Array(4);
  for (const gap of [1, 2, 3]) {
    expect(cs.readColumn(gap, out)).toBe(true);
    expect(Array.from(out)).toEqual([-127, -127, -127, -127]);
    expect(cs.getF0(gap)).toBe(-1);
  }
  expect(cs.readColumn(4, out)).toBe(true);
  expect(Array.from(out)).toEqual([-20, -20, -20, -20]);
  expect(cs.getF0(4)).toBeCloseTo(330, 3);
});

test("a gap wider than the ring leaves no stale columns behind", () => {
  const cs = new ColumnStore(3, 4);
  cs.push(0, col(-10), 220);
  cs.push(1, col(-11), 220);
  cs.push(50, col(-20), 440);
  expect(cs.writeIndex).toBe(51);
  expect(cs.earliestIndex).toBe(48);

  const out = new Int8Array(4);
  for (const c of [48, 49]) {
    expect(cs.readColumn(c, out)).toBe(true);
    expect(Array.from(out)).toEqual([-127, -127, -127, -127]);
  }
  expect(cs.readColumn(50, out)).toBe(true);
  expect(Array.from(out)).toEqual([-20, -20, -20, -20]);
});
