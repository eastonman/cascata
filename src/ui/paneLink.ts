import { HOP } from "../config";
import type { ViewState } from "./viewState";

/**
 * Keeps two panes' views in step when Link is on.
 *
 * Pure over ViewState, which owns no DOM — so the whole linking rule is
 * testable without a canvas, which matters because it is the part most likely
 * to be subtly wrong and the part a screenshot cannot check.
 */

/**
 * The offset to record when Link is pressed.
 *
 * Taking it from where the panes already are is what makes linking a no-op at
 * the moment it happens: the user aligns two takes by dragging them, and Link
 * simply freezes that relationship. It also means there is no offset control
 * to design, label, or persist.
 */
export function linkOffset(a: ViewState, b: ViewState): number {
  return b.startCol - a.startCol;
}

/**
 * Puts `follower` at `master.startCol + offsetCols`, matching zoom.
 *
 * Returns the correction the *master* needs so the pair stays consistent. Two
 * recordings are rarely the same length, so the follower can hit its own
 * earliest or latest column while the master still has room. Left alone the two
 * would drift and "linked" would quietly stop being true; the caller applies
 * the returned delta to the master instead, which stops both at the tighter of
 * the two bounds.
 */
export function mirrorView(master: ViewState, follower: ViewState, offsetCols: number): number {
  follower.pxPerCol = master.pxPerCol;
  const desired = master.startCol + offsetCols;
  follower.panColumns(desired - follower.startCol);
  return follower.startCol - desired;
}

/**
 * The sample in the other pane showing the same moment.
 *
 * `direction` is +1 going from the offset's reference pane to the other, -1
 * coming back. Unlinked, the panes share no common timeline, so the same
 * absolute sample index is the only honest answer.
 */
export function equivalentSample(
  sample: number,
  direction: 1 | -1,
  offsetCols: number,
  linked: boolean,
): number {
  if (!linked) return Math.max(0, sample);
  return Math.max(0, sample + direction * offsetCols * HOP);
}
