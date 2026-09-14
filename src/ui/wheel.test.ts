import { expect, test } from "bun:test";
import { ViewState } from "./viewState";
import { DOM_DELTA_LINE, DOM_DELTA_PAGE, DOM_DELTA_PIXEL, wheelPanPixels } from "./wheel";

const WIDTH = 1000;

function wheel(over: Partial<Parameters<typeof wheelPanPixels>[0]> = {}) {
  return { deltaX: 0, deltaY: 0, deltaMode: DOM_DELTA_PIXEL, ...over };
}

test("scrolling down advances through the recording", () => {
  // panPixels takes a pointer delta where dragging right goes back in time, so
  // moving forward means a negative result.
  expect(wheelPanPixels(wheel({ deltaY: 120 }), WIDTH)).toBe(-120);
  expect(wheelPanPixels(wheel({ deltaY: -120 }), WIDTH)).toBe(120);
});

test("a horizontal wheel or trackpad works the same way", () => {
  expect(wheelPanPixels(wheel({ deltaX: 80 }), WIDTH)).toBe(-80);
  expect(wheelPanPixels(wheel({ deltaX: -80 }), WIDTH)).toBe(80);
});

test("the axis that moved further wins", () => {
  // A diagonal trackpad gesture reports both; taking the dominant one keeps a
  // mostly-vertical flick from being read as a tiny horizontal one.
  expect(wheelPanPixels(wheel({ deltaX: 10, deltaY: 90 }), WIDTH)).toBe(-90);
  expect(wheelPanPixels(wheel({ deltaX: 90, deltaY: 10 }), WIDTH)).toBe(-90);
});

test("line-mode deltas are scaled to pixels", () => {
  // Firefox reports lines. A notch of 3 read raw would move the view three
  // pixels, which is indistinguishable from nothing.
  const lines = wheelPanPixels(wheel({ deltaY: 3, deltaMode: DOM_DELTA_LINE }), WIDTH);
  expect(lines).toBe(-48);
  expect(Math.abs(lines)).toBeGreaterThan(Math.abs(wheelPanPixels(wheel({ deltaY: 3 }), WIDTH)));
});

test("page-mode deltas scale with the viewport", () => {
  expect(wheelPanPixels(wheel({ deltaY: 1, deltaMode: DOM_DELTA_PAGE }), WIDTH)).toBe(-WIDTH);
  expect(wheelPanPixels(wheel({ deltaY: 1, deltaMode: DOM_DELTA_PAGE }), 400)).toBe(-400);
});

test("an unknown deltaMode is treated as pixels rather than dropped", () => {
  expect(wheelPanPixels(wheel({ deltaY: 50, deltaMode: 99 }), WIDTH)).toBe(-50);
});

test("a stationary wheel event moves nothing", () => {
  expect(wheelPanPixels(wheel(), WIDTH)).toBe(-0);
});

test("feeding the result to panPixels moves the view the expected way", () => {
  const view = new ViewState({ sampleRate: 48000 });
  view.widthPx = WIDTH;
  view.pxPerCol = 1;
  view.setEarliest(0);
  view.setLatest(5000);
  view.panColumns(-500); // pin it somewhere with room on both sides
  const start = view.startCol;

  view.panPixels(wheelPanPixels(wheel({ deltaY: 200 }), WIDTH));
  expect(view.startCol).toBe(start + 200);

  view.panPixels(wheelPanPixels(wheel({ deltaY: -200 }), WIDTH));
  expect(view.startCol).toBe(start);
});
