import {
  A4_OPTIONS,
  COLORMAP_NAMES,
  DEFAULT_COLORMAP,
  DB_FLOOR_MAX,
  DB_FLOOR_MIN,
  DB_RANGE_MAX,
  DB_RANGE_MIN,
  DEFAULT_A4,
  DEFAULT_DB_FLOOR,
  DEFAULT_DB_RANGE,
  DEFAULT_FFT_SIZE,
  DEFAULT_FREQ_LIMIT,
  DEFAULT_TIME_ZOOM,
  FFT_SIZES,
  FREQ_LIMITS,
  TIME_ZOOMS,
  type ColormapName,
  type FftSize,
} from "../config";

export const SETTINGS_KEY = "cascata.settings.v1";

export interface Settings {
  fftSize: FftSize;
  freqLimit: number;
  colormap: ColormapName;
  timeZoom: number;
  dbFloor: number;
  dbRange: number;
  a4: number;
  pitchEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fftSize: DEFAULT_FFT_SIZE,
  freqLimit: DEFAULT_FREQ_LIMIT,
  colormap: DEFAULT_COLORMAP,
  timeZoom: DEFAULT_TIME_ZOOM,
  dbFloor: DEFAULT_DB_FLOOR,
  dbRange: DEFAULT_DB_RANGE,
  a4: DEFAULT_A4,
  pitchEnabled: true,
};

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clamped(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Settings persistence behind an adapter (DESIGN.md §8). The `storage`
 * parameter is what lets this be tested without a DOM, and what the Tauri
 * store implementation will replace at M3.
 *
 * Loading never throws and never returns a partially valid object: each field
 * is validated independently so one corrupt key cannot reset the others. A
 * settings blob that fails to parse is not worth surfacing to the user — the
 * defaults are all usable.
 */
export function loadSettings(storage: Storage = localStorage): Settings {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw) return { ...DEFAULT_SETTINGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SETTINGS };

  const o = parsed as Record<string, unknown>;
  return {
    fftSize: oneOf(o.fftSize, FFT_SIZES, DEFAULT_SETTINGS.fftSize),
    freqLimit: oneOf(o.freqLimit, FREQ_LIMITS, DEFAULT_SETTINGS.freqLimit),
    colormap: oneOf(o.colormap, COLORMAP_NAMES, DEFAULT_SETTINGS.colormap),
    timeZoom: oneOf(o.timeZoom, TIME_ZOOMS, DEFAULT_SETTINGS.timeZoom),
    dbFloor: clamped(o.dbFloor, DB_FLOOR_MIN, DB_FLOOR_MAX, DEFAULT_SETTINGS.dbFloor),
    dbRange: clamped(o.dbRange, DB_RANGE_MIN, DB_RANGE_MAX, DEFAULT_SETTINGS.dbRange),
    a4: oneOf(o.a4, A4_OPTIONS, DEFAULT_SETTINGS.a4),
    pitchEnabled:
      typeof o.pitchEnabled === "boolean" ? o.pitchEnabled : DEFAULT_SETTINGS.pitchEnabled,
  };
}

export function saveSettings(settings: Settings, storage: Storage = localStorage): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota. Settings are a convenience, not data:
    // losing them costs the user a few clicks, so failing silently is right.
  }
}
