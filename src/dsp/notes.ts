const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Fractional MIDI note number for a frequency, under the given A4 calibration. */
export function freqToMidi(freq: number, a4: number): number {
  return 69 + 12 * Math.log2(freq / a4);
}

export function midiToFreq(midi: number, a4: number): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

/** Scientific pitch notation, e.g. 69 -> "A4". */
export function noteName(midi: number): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return `${NAMES[pc]}${octave}`;
}

export interface NoteReading {
  name: string;
  /** Signed deviation from the nearest semitone, in cents, within (-50, 50]. */
  cents: number;
  midi: number;
}

export function describeFreq(freq: number, a4: number): NoteReading | null {
  if (!(freq > 0) || !Number.isFinite(freq)) return null;
  const midi = freqToMidi(freq, a4);
  const nearest = Math.round(midi);
  return { name: noteName(nearest), cents: (midi - nearest) * 100, midi };
}
