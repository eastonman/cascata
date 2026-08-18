/**
 * The absolute-index scheme shared by PcmRing and ColumnStore (DESIGN.md §4).
 *
 * Both stores expose counters that only ever increase, with overwriting
 * expressed as `earliestIndex` moving forward rather than as any counter
 * resetting. ViewState consumes the two interchangeably, so stating the
 * contract as a type keeps them checkably in step instead of in step by
 * comment.
 */
export interface AbsoluteRing {
  /** Count of items ever written. Never resets. */
  readonly writeIndex: number;
  /** Lowest absolute index still retained. */
  readonly earliestIndex: number;
}

/**
 * Slot holding an absolute index in a ring of `capacity`.
 *
 * The double modulo tolerates negative indices, which the view can produce
 * before a full screen has been recorded. Callers that have already bounds
 * checked pay one extra remainder for it; at these call rates that is free,
 * and one spelling everywhere beats two that a reader has to prove equivalent.
 */
export function ringSlot(index: number, capacity: number): number {
  return ((index % capacity) + capacity) % capacity;
}
