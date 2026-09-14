/** The part of a WheelEvent this needs, so it can be tested without a DOM. */
export interface WheelDelta {
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages, per the DOM spec. */
  deltaMode: number;
}

/** Rough line height in pixels, for browsers that report wheel deltas in lines. */
const LINE_PX = 16;

export const DOM_DELTA_PIXEL = 0;
export const DOM_DELTA_LINE = 1;
export const DOM_DELTA_PAGE = 2;

/**
 * Converts a wheel event into the pointer delta `ViewState.panPixels` expects.
 *
 * Two conversions and a sign, none of them obvious:
 *
 * - **Axis.** A mouse usually has only a vertical wheel, a trackpad reports
 *   both, and shift+wheel may arrive on either. Taking whichever axis moved
 *   further lets one handler serve all three without the caller caring which
 *   device is attached.
 * - **Units.** deltaMode is not always pixels. Firefox reports lines, and a
 *   value of 3 means three lines, not three pixels — read raw, a notch would
 *   move the view by almost nothing.
 * - **Sign.** Scrolling down or right advances through the recording, matching
 *   how a wheel moves a document. panPixels takes a *pointer* delta, where
 *   dragging right goes back in time, so the sign flips here.
 */
export function wheelPanPixels(event: WheelDelta, viewportWidthPx: number): number {
  const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

  let pixels: number;
  switch (event.deltaMode) {
    case DOM_DELTA_LINE:
      pixels = raw * LINE_PX;
      break;
    case DOM_DELTA_PAGE:
      pixels = raw * viewportWidthPx;
      break;
    default:
      pixels = raw;
  }

  return -pixels;
}
