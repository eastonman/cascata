export type PaneIndex = 0 | 1;

export interface Selection {
  /** Whether the second pane is shown at all. */
  compare: boolean;
  /** Which pane the keyboard, Play, and Export act on. */
  active: PaneIndex;
  /** Which pane Record writes into. */
  armed: PaneIndex;
  /** Whether the two views scroll together. */
  linked: boolean;
}

export const INITIAL_SELECTION: Selection = {
  compare: false,
  active: 0,
  armed: 0,
  linked: false,
};

/**
 * Which pane is shown, focused, armed, and linked.
 *
 * Ten lines of rules, extracted because one of them failing is silent: an
 * armed index left pointing at pane B after compare mode closes sends the next
 * recording into a pane nobody can see, and the only symptom is that Record
 * appears to do nothing. Pure, so the invariants are checked rather than
 * assumed.
 */

/** Pane B does not exist outside compare mode, so neither focus nor arming can be there. */
function confine(selection: Selection): Selection {
  if (selection.compare) return selection;
  return { ...selection, active: 0, armed: 0, linked: false };
}

export function setCompare(selection: Selection, compare: boolean): Selection {
  return confine({ ...selection, compare });
}

export function setActive(selection: Selection, index: PaneIndex): Selection {
  return confine({ ...selection, active: index });
}

/**
 * Arming is locked while capture runs: moving it mid-recording would leave
 * samples arriving at one pane while the UI claimed another was recording.
 */
export function setArmed(selection: Selection, index: PaneIndex, capturing: boolean): Selection {
  if (capturing) return selection;
  return confine({ ...selection, armed: index });
}

export function setLinked(selection: Selection, linked: boolean): Selection {
  return confine({ ...selection, linked });
}

/** The other pane, for Tab and for mirroring. */
export function other(index: PaneIndex): PaneIndex {
  return index === 0 ? 1 : 0;
}
