/**
 * Periodic Hann window: w[n] = 0.5 * (1 - cos(2*pi*n / N)).
 *
 * The periodic (rather than symmetric) form is the right one for STFT analysis
 * — it makes overlapping frames sum flat and gives windowSum exactly N/2.
 */
export function hann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let n = 0; n < size; n++) {
    w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / size));
  }
  return w;
}

/** Coherent gain of a window, used to normalise magnitudes back to full scale. */
export function windowSum(w: Float32Array): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return s;
}
