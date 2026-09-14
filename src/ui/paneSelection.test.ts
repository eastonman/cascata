import { expect, test } from "bun:test";
import {
  INITIAL_SELECTION,
  other,
  type Selection,
  setActive,
  setArmed,
  setCompare,
  setLinked,
} from "./paneSelection";

function compared(): Selection {
  return setCompare(INITIAL_SELECTION, true);
}

test("a fresh selection is single-pane, focused and armed on A", () => {
  expect(INITIAL_SELECTION).toEqual({ compare: false, active: 0, armed: 0, linked: false });
});

test("focus and arming can move to B only in compare mode", () => {
  const single = setArmed(setActive(INITIAL_SELECTION, 1), 1, false);
  expect(single.active).toBe(0);
  expect(single.armed).toBe(0);

  const both = setArmed(setActive(compared(), 1), 1, false);
  expect(both.active).toBe(1);
  expect(both.armed).toBe(1);
});

test("leaving compare mode brings arming back to A", () => {
  // The bug this exists to prevent: arming left on B sends the next recording
  // into a pane that is not on screen, and Record looks like it does nothing.
  const armedOnB = setArmed(compared(), 1, false);
  expect(armedOnB.armed).toBe(1);

  const closed = setCompare(armedOnB, false);
  expect(closed.armed).toBe(0);
  expect(closed.active).toBe(0);
});

test("leaving compare mode unlinks", () => {
  const linked = setLinked(compared(), true);
  expect(linked.linked).toBe(true);
  expect(setCompare(linked, false).linked).toBe(false);
});

test("linking is impossible without a second pane to link to", () => {
  expect(setLinked(INITIAL_SELECTION, true).linked).toBe(false);
});

test("arming is locked while capturing", () => {
  const before = setArmed(compared(), 0, false);
  const during = setArmed(before, 1, true);
  expect(during.armed).toBe(0);
  expect(during).toBe(before); // unchanged, not a new equivalent object
});

test("arming moves again once capture stops", () => {
  const stopped = setArmed(setArmed(compared(), 1, true), 1, false);
  expect(stopped.armed).toBe(1);
});

test("re-entering compare mode does not restore the old focus", () => {
  // Focus was confined to A on the way out, and there is nothing to restore
  // it from -- re-entering starts on A, which is where the eye already is.
  const cycled = setCompare(setCompare(setActive(compared(), 1), false), true);
  expect(cycled.active).toBe(0);
});

test("every transition leaves a valid state in single-pane mode", () => {
  const ops: ((s: Selection) => Selection)[] = [
    (s) => setActive(s, 1),
    (s) => setArmed(s, 1, false),
    (s) => setLinked(s, true),
    (s) => setCompare(s, false),
  ];
  let s = compared();
  for (const op of ops) s = op(s);
  for (const op of ops) s = op(s);
  if (!s.compare) {
    expect(s.active).toBe(0);
    expect(s.armed).toBe(0);
    expect(s.linked).toBe(false);
  }
});

test("other flips the index", () => {
  expect(other(0)).toBe(1);
  expect(other(1)).toBe(0);
});
