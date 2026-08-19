import { BIN_COUNT, HOP } from "../config";

export interface CapacityPlan {
  /** Seconds of audio the stores will hold. */
  seconds: number;
  /** True when the request was longer than the byte budget allows. */
  truncated: boolean;
  /** Total bytes the stores will allocate for `seconds`. */
  bytes: number;
}

/**
 * Bytes of store per second of audio: Int16 PCM, plus one Int8 column of
 * BIN_COUNT bins and one Float32 f0 per HOP samples.
 *
 * At 48 kHz this is 96 000 + 28 125 + 187.5 = 124 312.5 B/s.
 */
export function storeBytesPerSecond(sampleRate: number): number {
  const colsPerSecond = sampleRate / HOP;
  return sampleRate * 2 + colsPerSecond * BIN_COUNT + colsPerSecond * 4;
}

/** Bytes the stores actually allocate for a whole number of samples and columns. */
function exactBytes(seconds: number, sampleRate: number): number {
  const samples = Math.ceil(seconds * sampleRate);
  const cols = Math.ceil(samples / HOP);
  return samples * 2 + cols * BIN_COUNT + cols * 4;
}

/**
 * How much of `durationSec` fits within `maxBytes` of store.
 *
 * The budget is expressed in bytes rather than minutes so the limit follows
 * the device sample rate: 1 GiB is ~144 min at 48 kHz but ~157 min at 44.1 kHz,
 * and neither number has to be written down anywhere.
 *
 * `bytes` is the real allocation — sample and column counts rounded up — not
 * `seconds * bytesPerSecond`, so a caller can compare it against a budget
 * without discovering the rounding afterwards.
 */
export function planImportCapacity(
  durationSec: number,
  sampleRate: number,
  maxBytes: number,
): CapacityPlan {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { seconds: 0, truncated: false, bytes: 0 };
  }

  // Decide on the real allocation, not on seconds * bytesPerSecond: rounding
  // sample and column counts up can push a duration that "fits" by rate over
  // the budget by a few hundred bytes.
  const requested = exactBytes(durationSec, sampleRate);
  if (requested <= maxBytes) {
    return { seconds: durationSec, truncated: false, bytes: requested };
  }

  // Trim to whole hops, then step down until the rounded allocation is inside
  // the budget. The estimate is close, so this costs at most a few iterations.
  let hops = Math.floor((maxBytes / storeBytesPerSecond(sampleRate)) * (sampleRate / HOP));
  while (hops > 0 && exactBytes((hops * HOP) / sampleRate, sampleRate) > maxBytes) hops--;

  const seconds = (hops * HOP) / sampleRate;
  return { seconds, truncated: true, bytes: hops > 0 ? exactBytes(seconds, sampleRate) : 0 };
}
