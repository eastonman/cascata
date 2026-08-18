/**
 * Global analysis and storage constants (DESIGN.md §4, §5).
 *
 * These are compile-time constants rather than settings: the hop and the log
 * bin layout define the time/frequency grid that every stored column shares,
 * so changing them at runtime would invalidate the whole store.
 */

/** Samples between adjacent spectrum columns. Constant so the time axis speed is constant. */
export const HOP = 1024;

/** Log-spaced frequency bins stored per column (~77 bins/octave over F_MIN..F_MAX). */
export const BIN_COUNT = 600;

/** Lowest stored frequency, Hz. */
export const F_MIN = 55;

/** Highest stored frequency, Hz. */
export const F_MAX = 12000;

/** Ring buffer depth in seconds. Older audio is overwritten. */
export const RECORD_SECONDS = 480;

export const FFT_SIZES = [2048, 4096, 8192] as const;
export type FftSize = (typeof FFT_SIZES)[number];
export const DEFAULT_FFT_SIZE: FftSize = 4096;

/** A4 reference pitches offered for calibration, Hz. */
export const A4_OPTIONS = [440, 442, 443] as const;
export const DEFAULT_A4 = 440;

/** Display-only upper frequency bounds, Hz. Switching these crops, never recomputes. */
export const FREQ_LIMITS = [2000, 5000, 8000, 12000] as const;
export const DEFAULT_FREQ_LIMIT = 5000;

/** Horizontal pixels per spectrum column. */
export const TIME_ZOOMS = [0.5, 1, 2, 4] as const;
export const DEFAULT_TIME_ZOOM = 1;

/**
 * Selectable colormaps. The name list lives here with the other user-facing
 * option lists so settings validation does not have to reach into `render/`;
 * the lookup tables themselves stay in `render/colormap.ts`.
 */
export const COLORMAP_NAMES = ["magma", "viridis", "gray"] as const;
export type ColormapName = (typeof COLORMAP_NAMES)[number];
export const DEFAULT_COLORMAP: ColormapName = "magma";

/** Colouring maps [DEFAULT_DB_FLOOR, DEFAULT_DB_FLOOR + DEFAULT_DB_RANGE] dBFS onto the colormap. */
export const DEFAULT_DB_FLOOR = -92;
export const DEFAULT_DB_RANGE = 66;
export const DB_FLOOR_MIN = -127;
export const DB_FLOOR_MAX = -40;
export const DB_RANGE_MIN = 20;
export const DB_RANGE_MAX = 100;

/** YIN parameters (DESIGN.md §5.2). */
export const YIN_WINDOW = 1024;
export const YIN_FMIN = 55;
export const YIN_FMAX = 1200;
export const YIN_THRESHOLD = 0.15;
export const YIN_SILENCE_DB = -55;

/** Playback is capped so a long scrollback cannot start an unstoppable 8-minute play. */
export const MAX_PLAYBACK_SECONDS = 300;
