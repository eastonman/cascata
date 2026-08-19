import {
  A4_OPTIONS,
  DB_FLOOR_MAX,
  DB_FLOOR_MIN,
  DB_RANGE_MAX,
  DB_RANGE_MIN,
  FFT_SIZES,
  FREQ_LIMITS,
  TIME_ZOOMS,
} from "../config";
import type { Settings } from "../platform/settings";
import { COLORMAP_NAMES } from "../render/colormap";

export interface ControlHandlers {
  onToggleCapture(): void;
  onTogglePlay(): void;
  onFollow(): void;
  onExport(): void;
  onImport(file: File): void;
  onClear(): void;
  onSettingsChange(patch: Partial<Settings>): void;
}

export interface ControlsHandle {
  setCaptureState(on: boolean): void;
  setPlayState(on: boolean): void;
  setFollowState(following: boolean): void;
  setExportEnabled(enabled: boolean): void;
  setPlayEnabled(enabled: boolean): void;
  setImportEnabled(enabled: boolean): void;
  setClearEnabled(enabled: boolean): void;
  setStatus(text: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

/**
 * Clicking a button focuses it in Chrome, and the keydown handler ignores
 * events targeting a BUTTON — so after clicking Record, Space would re-trigger
 * Record (stopping the recording) instead of starting playback, and the arrow
 * keys would be dead. Blurring on click keeps the DESIGN.md §7 shortcuts alive.
 */
function onClick(button: HTMLButtonElement, handler: () => void): void {
  button.addEventListener("click", () => {
    button.blur();
    handler();
  });
}

function group(label: string, control: HTMLElement): HTMLDivElement {
  const wrap = el("div", { className: "group" });
  wrap.append(el("span", { textContent: label }), control);
  return wrap;
}

function select<T extends string | number>(
  options: readonly T[],
  current: T,
  format: (v: T) => string,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const s = el("select");
  for (const opt of options) {
    s.append(
      el("option", { value: String(opt), textContent: format(opt), selected: opt === current }),
    );
  }
  s.addEventListener("change", () => {
    const raw = s.value;
    const picked = options.find((o) => String(o) === raw);
    if (picked !== undefined) onChange(picked);
  });
  return s;
}

function slider(
  min: number,
  max: number,
  value: number,
  onInput: (v: number) => void,
): { input: HTMLInputElement; readout: HTMLSpanElement } {
  const input = el("input", {
    type: "range",
    min: String(min),
    max: String(max),
    value: String(value),
  });
  const readout = el("span", { textContent: String(value) });
  // The readout follows the thumb live, but the setting itself is committed on
  // release. Each commit invalidates the offscreen ring and re-renders every
  // visible column, so firing on `input` would do that ~60 times a second.
  input.addEventListener("input", () => {
    readout.textContent = input.value;
  });
  input.addEventListener("change", () => onInput(Number(input.value)));
  return { input, readout };
}

/**
 * Builds the control bar. Every change emits a one-key patch so the app can
 * apply exactly the work each setting needs — most of them only recolour or
 * recrop, and none of them touch the recorded PCM.
 */
export function createControls(
  root: HTMLElement,
  settings: Settings,
  handlers: ControlHandlers,
): ControlsHandle {
  const bar = el("div", { id: "controls" });

  const record = el("button", { id: "record", textContent: "Record" });
  onClick(record, () => handlers.onToggleCapture());

  const play = el("button", { id: "play", textContent: "Play" });
  onClick(play, () => handlers.onTogglePlay());

  const followBtn = el("button", { id: "follow", textContent: "Follow" });
  onClick(followBtn, () => handlers.onFollow());

  const exportBtn = el("button", { id: "export", textContent: "Export WAV" });
  onClick(exportBtn, () => handlers.onExport());

  // A hidden input rather than a visible one: the file control's native
  // appearance cannot be styled to match the rest of the bar, and the button
  // needs to carry an enabled state of its own.
  const fileInput = el("input", { type: "file", accept: "audio/*", hidden: true });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    // Reset first, so picking the same file twice in a row still fires change.
    fileInput.value = "";
    if (file) handlers.onImport(file);
  });

  const importBtn = el("button", { id: "import", textContent: "Import" });
  onClick(importBtn, () => fileInput.click());

  const clearBtn = el("button", { id: "clear", textContent: "Clear" });
  onClick(clearBtn, () => handlers.onClear());

  const windowSel = select(
    FFT_SIZES,
    settings.fftSize,
    (v) => String(v),
    (v) => handlers.onSettingsChange({ fftSize: v }),
  );
  const freqSel = select(
    FREQ_LIMITS,
    settings.freqLimit,
    (v) => `${v / 1000} kHz`,
    (v) => handlers.onSettingsChange({ freqLimit: v }),
  );
  const colorSel = select(
    COLORMAP_NAMES,
    settings.colormap,
    (v) => v,
    (v) => handlers.onSettingsChange({ colormap: v }),
  );
  const zoomSel = select(
    TIME_ZOOMS,
    settings.timeZoom,
    (v) => `${v}x`,
    (v) => handlers.onSettingsChange({ timeZoom: v }),
  );
  const a4Sel = select(
    A4_OPTIONS,
    settings.a4,
    (v) => `${v} Hz`,
    (v) => handlers.onSettingsChange({ a4: v }),
  );

  const floor = slider(DB_FLOOR_MIN, DB_FLOOR_MAX, settings.dbFloor, (v) =>
    handlers.onSettingsChange({ dbFloor: v }),
  );
  const range = slider(DB_RANGE_MIN, DB_RANGE_MAX, settings.dbRange, (v) =>
    handlers.onSettingsChange({ dbRange: v }),
  );

  const pitch = el("input", { type: "checkbox", checked: settings.pitchEnabled });
  pitch.addEventListener("change", () =>
    handlers.onSettingsChange({ pitchEnabled: pitch.checked }),
  );
  const pitchLabel = el("label", { className: "check" });
  pitchLabel.append(pitch, el("span", { textContent: "Pitch" }));

  const status = el("div", { id: "status", textContent: "Idle" });

  bar.append(
    record,
    play,
    followBtn,
    importBtn,
    clearBtn,
    exportBtn,
    fileInput,
    group("Window", windowSel),
    group("Max freq", freqSel),
    group("Colors", colorSel),
    group("Zoom", zoomSel),
    group("A4", a4Sel),
    group("Floor", floor.input),
    floor.readout,
    group("Range", range.input),
    range.readout,
    pitchLabel,
    el("div", { className: "spacer" }),
    status,
  );
  root.append(bar);

  return {
    setCaptureState(on) {
      record.textContent = on ? "Stop" : "Record";
      record.dataset.active = String(on);
    },
    setPlayState(on) {
      play.textContent = on ? "Stop" : "Play";
      play.dataset.active = String(on);
    },
    setFollowState(following) {
      followBtn.disabled = following;
      followBtn.dataset.active = String(!following);
    },
    setExportEnabled(enabled) {
      exportBtn.disabled = !enabled;
    },
    setPlayEnabled(enabled) {
      play.disabled = !enabled;
    },
    setImportEnabled(enabled) {
      importBtn.disabled = !enabled;
    },
    setClearEnabled(enabled) {
      clearBtn.disabled = !enabled;
    },
    setStatus(text) {
      status.textContent = text;
    },
  };
}
