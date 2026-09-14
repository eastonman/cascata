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
 * How the two comparison panes are arranged.
 *
 * Neither direction dominates. Stacked puts the same frequency at the same
 * screen height in both panes, so a pitch or formant difference is read
 * directly — the better default. Side by side gives each pane full height at
 * the cost of showing half as much time, and is the only usable choice on a
 * short landscape window. Hence a setting.
 */
export const PANE_LAYOUTS = ["stacked", "columns"] as const;
export type PaneLayout = (typeof PANE_LAYOUTS)[number];
export const DEFAULT_PANE_LAYOUT: PaneLayout = "stacked";

/**
 * Selectable colormaps. The name list lives here with the other user-facing
 * option lists so settings validation does not have to reach into `render/`;
 * the lookup tables themselves stay in `render/colormap.ts`.
 */
export const COLORMAP_NAMES = ["magma", "viridis", "turbo", "gray"] as const;
export type ColormapName = (typeof COLORMAP_NAMES)[number];
export const DEFAULT_COLORMAP: ColormapName = "magma";

/**
 * The maps that promise perceptually uniform intensity, and are tested for it.
 *
 * Declared here rather than repeated as literals inside the tests, so that
 * adding a map forces a decision about which group it joins. `turbo` is
 * deliberately not in this list: it trades uniformity for contrast, which is
 * the whole reason it exists.
 */
export const PERCEPTUAL_COLORMAPS = ["magma", "viridis"] as const;

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

/**
 * Playback cap, seconds.
 *
 * Bounds both how long an uncued Play can run and how much PCM is copied into
 * an AudioBuffer. At 48 kHz Float32 that buffer is 0.192 MB/s, so 120 s costs
 * 23 MB — which keeps the 59.7 MB of stores plus the canvases inside the
 * 100 MB budget in DESIGN.md §1.2. The original 300 s would have cost 57.6 MB
 * and broken that budget on the default Play action.
 */
export const MAX_PLAYBACK_SECONDS = 120;

/**
 * Store budget for an imported file, in bytes. ~144 min at 48 kHz.
 *
 * This deliberately exceeds the 100 MB budget in DESIGN.md §1.2, which applies
 * to the recording path: RECORD_SECONDS is unchanged, so a live recording
 * still costs ~60 MB. An import is a one-off the user asked for, and its cost
 * is proportional to the file — a 3-minute import allocates ~22 MB. Only files
 * over about two hours reach this cap, and importing one on a phone may get
 * the tab killed by the OS with no catchable error. IMPORT_WARN_BYTES is the
 * warning; past it the outcome is not guaranteed.
 */
export const MAX_IMPORT_BYTES = 1024 ** 3;

/** Above this planned allocation, warn before importing. ~40 min at 48 kHz. */
export const IMPORT_WARN_BYTES = 300 * 1024 ** 2;

/**
 * Per-frame budget for catching the analyzer up to available PCM.
 *
 * Spent as a time budget rather than a fixed column count because device speed
 * varies by an order of magnitude; a count tuned on a laptop drops a phone to
 * single-digit frame rates. At ~0.34 ms/column this buys ~23 columns a frame,
 * roughly 30x faster than the 46.9 columns/s a live recording produces.
 */
export const ANALYSIS_BUDGET_MS = 8;
