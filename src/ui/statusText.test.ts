import { expect, test } from "bun:test";
import { type PaneStatus, type StatusInputs, statusText } from "./statusText";

function pane(over: Partial<PaneStatus> = {}): PaneStatus {
  return {
    label: "A",
    hasData: true,
    analysisProgress: 1,
    backlogColumns: 0,
    durationSeconds: 12.3,
    following: true,
    bytes: 60 * 1024 ** 2,
    ...over,
  };
}

function inputs(over: Partial<StatusInputs> = {}): StatusInputs {
  return {
    panes: [pane()],
    activeIndex: 0,
    capturing: false,
    compare: false,
    linked: false,
    held: null,
    now: 1000,
    memoryNoticeBytes: 300 * 1024 ** 2,
    ...over,
  };
}

test("the idle line reports mode, follow state, and buffered length", () => {
  const s = statusText(inputs())!;
  expect(s).toContain("Stopped");
  expect(s).toContain("live");
  expect(s).toContain("00:12.3 buffered");
});

test("a held message suppresses the state line entirely", () => {
  // Null, not the state line: writing anything here would erase the message
  // the app just posted, which is exactly the bug this replaced.
  const s = statusText(inputs({ held: { text: "Could not start capture: denied", until: 5000 } }));
  expect(s).toBeNull();
});

test("the state line returns once the hold expires", () => {
  const s = statusText(inputs({ held: { text: "gone", until: 500 }, now: 1000 }));
  expect(s).not.toBeNull();
  expect(s).toContain("Stopped");
});

test("analysis progress outranks a held message but carries it along", () => {
  const s = statusText(
    inputs({
      panes: [pane({ analysisProgress: 0.34, backlogColumns: 900 })],
      held: { text: "A: imported 03:00.0", until: 5000 },
    }),
  )!;
  expect(s).toContain("A: imported 03:00.0");
  expect(s).toContain("Analysing… 34%");
});

test("analysis progress alone once the hold has expired", () => {
  const s = statusText(
    inputs({
      panes: [pane({ analysisProgress: 0.5, backlogColumns: 10 })],
      held: { text: "old", until: 100 },
      now: 1000,
    }),
  )!;
  expect(s).toBe("Analysing… 50%");
});

test("both panes' progress is shown, labelled, in compare mode", () => {
  const s = statusText(
    inputs({
      compare: true,
      panes: [
        pane({ label: "A", analysisProgress: 0.2, backlogColumns: 100 }),
        pane({ label: "B", analysisProgress: 0.9, backlogColumns: 10 }),
      ],
    }),
  )!;
  expect(s).toContain("A 20%");
  expect(s).toContain("B 90%");
});

test("a pane with no data is not reported as analysing", () => {
  const s = statusText(
    inputs({
      compare: true,
      panes: [pane({ label: "A" }), pane({ label: "B", hasData: false, backlogColumns: 500 })],
    }),
  )!;
  expect(s).not.toContain("Analysing");
});

test("capture suppresses the analysis line", () => {
  // While recording, the backlog is a frame or two and the buffered length is
  // the useful number.
  const s = statusText(
    inputs({ capturing: true, panes: [pane({ analysisProgress: 0.99, backlogColumns: 2 })] }),
  )!;
  expect(s).toContain("Recording");
  expect(s).not.toContain("Analysing");
});

test("compare mode names the active pane and the link state", () => {
  const s = statusText(
    inputs({ compare: true, linked: true, panes: [pane({ label: "A" }), pane({ label: "B" })] }),
  )!;
  expect(s).toContain("· A ·");
  expect(s).toContain("linked");

  const unlinked = statusText(
    inputs({ compare: true, linked: false, panes: [pane(), pane({ label: "B" })] }),
  )!;
  expect(unlinked).toContain("unlinked");
});

test("single-pane mode names neither the pane nor the link state", () => {
  const s = statusText(inputs())!;
  expect(s).not.toContain("· A ·");
  expect(s).not.toContain("linked");
});

test("the active pane is the one described", () => {
  const s = statusText(
    inputs({
      compare: true,
      activeIndex: 1,
      panes: [pane({ label: "A", durationSeconds: 1 }), pane({ label: "B", durationSeconds: 99 })],
    }),
  )!;
  expect(s).toContain("· B ·");
  expect(s).toContain("01:39.0 buffered");
});

test("the memory total appears only once the panes are heavy", () => {
  const light = statusText(inputs({ panes: [pane({ bytes: 60 * 1024 ** 2 })] }))!;
  expect(light).not.toContain("MB");

  const heavy = statusText(
    inputs({
      compare: true,
      panes: [pane({ bytes: 400 * 1024 ** 2 }), pane({ label: "B", bytes: 400 * 1024 ** 2 })],
    }),
  )!;
  expect(heavy).toContain("800 MB");
});

test("an out-of-range active index yields nothing rather than throwing", () => {
  expect(statusText(inputs({ activeIndex: 5 }))).toBeNull();
});
