import { formatClock } from "../render/overlay";

/**
 * Everything the status bar says, as pure functions over plain values.
 *
 * The bar has two jobs that fight each other: reporting live state every
 * frame, and showing a message the user actually has to read. Getting that
 * wrong is invisible in review and obvious in use — before this logic was
 * pinned down, "Could not start capture" was written and then overwritten by
 * the next frame's state line, so it had never once been readable.
 */

export interface PaneStatus {
  label: string;
  hasData: boolean;
  /** 0..1; 1 means nothing owed. */
  analysisProgress: number;
  backlogColumns: number;
  durationSeconds: number;
  following: boolean;
  /** Bytes of store this pane has allocated. */
  bytes: number;
}

export interface StatusInputs {
  panes: PaneStatus[];
  activeIndex: number;
  capturing: boolean;
  compare: boolean;
  linked: boolean;
  /** A transient message and the time it stops holding the bar. */
  held: { text: string; until: number } | null;
  now: number;
  /** Combined store bytes above which the total is worth showing. */
  memoryNoticeBytes: number;
}

/**
 * Progress while any pane still owes analysis.
 *
 * This outranks a held message because it is the only sign the app is doing
 * anything during a long import — but the held text rides along rather than
 * being evicted, so an import's result and its progress are both visible.
 */
function analysisLine(inputs: StatusInputs): string | null {
  const busy = inputs.panes.filter((p) => p.hasData && p.backlogColumns > 0);
  if (busy.length === 0 || inputs.capturing) return null;

  const parts = busy.map((p) => {
    const pct = Math.floor(p.analysisProgress * 100);
    return inputs.compare ? `${p.label} ${pct}%` : `${pct}%`;
  });
  const held = holding(inputs) ? `${inputs.held?.text} · ` : "";
  return `${held}Analysing… ${parts.join(" · ")}`;
}

function holding(inputs: StatusInputs): boolean {
  return inputs.held !== null && inputs.now < inputs.held.until;
}

/** Only shown once the panes together are heavy enough to explain a slow tab. */
function memoryNote(inputs: StatusInputs): string {
  const bytes = inputs.panes.reduce((sum, p) => sum + p.bytes, 0);
  return bytes > inputs.memoryNoticeBytes ? ` · ${Math.round(bytes / 1024 ** 2)} MB` : "";
}

/**
 * The line the status bar should be showing, or null to leave it alone.
 *
 * Null means "a transient message is still holding the bar" — the caller must
 * not write, or the message it just posted would be erased on the next frame.
 */
export function statusText(inputs: StatusInputs): string | null {
  const analysing = analysisLine(inputs);
  if (analysing !== null) return analysing;
  if (holding(inputs)) return null;

  const pane = inputs.panes[inputs.activeIndex];
  if (!pane) return null;

  const mode = inputs.capturing ? "Recording" : "Stopped";
  const where = inputs.compare ? ` · ${pane.label}` : "";
  const follow = pane.following ? "live" : "pinned";
  const link = inputs.compare ? (inputs.linked ? " · linked" : " · unlinked") : "";
  return `${mode}${where} · ${follow}${link} · ${formatClock(pane.durationSeconds)} buffered${memoryNote(inputs)}`;
}
