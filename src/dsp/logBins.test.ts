import { expect, test } from "bun:test";
import { LogBinMap } from "./logBins";
import { Spectrum } from "./spectrum";

const SR = 48000;

test("centers span F_MIN..F_MAX geometrically", () => {
  const map = new LogBinMap(4096, SR);
  expect(map.centers.length).toBe(600);
  expect(map.centers[0]).toBeCloseTo(55, 6);
  expect(map.centers[599]).toBeCloseTo(12000, 3);
  const r1 = map.centers[1] / map.centers[0];
  const r2 = map.centers[300] / map.centers[299];
  expect(r1).toBeCloseTo(r2, 9);
});

test("resolution is about 77 bins per octave", () => {
  const perOctave = 599 / Math.log2(12000 / 55);
  expect(perOctave).toBeGreaterThan(76);
  expect(perOctave).toBeLessThan(78);
});

test("freqToBin and binToFreq round-trip", () => {
  const map = new LogBinMap(4096, SR);
  for (const f of [55, 220, 440, 1000, 12000]) {
    expect(map.binToFreq(map.freqToBin(f))).toBeCloseTo(f, 3);
  }
});

test("a pure tone lands on the log bin nearest its frequency", () => {
  const fftSize = 4096;
  const spec = new Spectrum(fftSize);
  const map = new LogBinMap(fftSize, SR);
  const mag = new Float32Array(spec.binCount);
  const out = new Int8Array(600);
  // Two resolution limits bound how close the peak log bin can sit to the true
  // frequency, and which one dominates flips partway up the range. Below
  // ~1.5 kHz the log bins are finer than the FFT bins, so the FFT grid is the
  // limit (11.7 Hz here). Above that one log bin spans several FFT bins, so
  // the log grid is the limit (45 Hz at 5 kHz). Assert against whichever is
  // coarser at that frequency.
  const fftBinHz = SR / fftSize;
  const logBinHz = (f: number) =>
    map.binToFreq(map.freqToBin(f) + 0.5) - map.binToFreq(map.freqToBin(f) - 0.5);

  for (const freq of [220, 440, 880, 2000, 5000]) {
    const frame = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) frame[i] = Math.sin((2 * Math.PI * freq * i) / SR);
    spec.compute(frame, mag);
    map.apply(mag, out);

    let peak = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[peak]) peak = i;
    expect(Math.abs(map.binToFreq(peak) - freq)).toBeLessThan(Math.max(fftBinHz, logBinHz(freq)));
    expect(out[peak]).toBeGreaterThan(-3);
  }
});

test("output is clamped into Int8 dB range", () => {
  const spec = new Spectrum(2048);
  const map = new LogBinMap(2048, SR);
  const mag = new Float32Array(spec.binCount);
  const out = new Int8Array(600);
  spec.compute(new Float32Array(2048), mag);
  map.apply(mag, out);
  for (const v of out) {
    expect(v).toBeGreaterThanOrEqual(-127);
    expect(v).toBeLessThanOrEqual(0);
  }
});

test("low log bins are interpolated rather than left empty", () => {
  // At fftSize 2048 / 48 kHz the FFT bin spacing is 23.4 Hz, far wider than
  // the ~1 Hz log-bin spacing near 120 Hz, so most low bins have no FFT bin
  // inside them and must be filled by interpolation.
  const fftSize = 2048;
  const spec = new Spectrum(fftSize);
  const map = new LogBinMap(fftSize, SR);
  const mag = new Float32Array(spec.binCount);
  const out = new Int8Array(600);
  const frame = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) frame[i] = Math.sin((2 * Math.PI * 120 * i) / SR);
  spec.compute(frame, mag);
  map.apply(mag, out);

  const near = Math.round(map.freqToBin(120));
  expect(out[near]).toBeGreaterThan(-20);
});

test("apply rejects wrongly sized buffers", () => {
  const map = new LogBinMap(2048, SR);
  expect(() => map.apply(new Float32Array(10), new Int8Array(600))).toThrow();
  expect(() => map.apply(new Float32Array(1025), new Int8Array(4))).toThrow();
});

test("log bins above Nyquist read as empty, not as the Nyquist bin", () => {
  // Reachable in practice: a Bluetooth headset mic on macOS drops the
  // AudioContext to 16 kHz, well under the 12 kHz display ceiling. Left
  // unhandled these bins all collapse onto the last FFT bin and paint a solid
  // stripe across the top of a spectrogram that should read empty.
  const sr = 16000;
  const fftSize = 4096;
  const spec = new Spectrum(fftSize);
  const map = new LogBinMap(fftSize, sr);
  const mag = new Float32Array(spec.binCount);
  const out = new Int8Array(600);

  const frame = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) frame[i] = Math.sin((2 * Math.PI * 7900 * i) / sr);
  spec.compute(frame, mag);
  map.apply(mag, out);

  const nyquistBin = Math.ceil(map.freqToBin(sr / 2));
  for (let i = nyquistBin + 1; i < 600; i++) {
    expect(out[i]).toBe(-127);
  }
  // The tone itself, just below Nyquist, is still visible.
  expect(out[Math.round(map.freqToBin(7900))]).toBeGreaterThan(-20);
});

test("log bin edges partition the FFT grid without gaps or overlap", () => {
  // Widening the edges (halfStep = ratio instead of sqrt(ratio)) makes adjacent
  // bins overlap 2x and every other assertion in this file still passes.
  const sr = 48000;
  const fftSize = 4096;
  const map = new LogBinMap(fftSize, sr);
  const claims = new Map<number, number>();

  const mag = new Float32Array(fftSize / 2 + 1).fill(-100);
  const out = new Int8Array(600);
  for (let k = 0; k < mag.length; k++) {
    const freq = (k * sr) / fftSize;
    if (freq < 55 || freq > 12000) continue;
    mag.fill(-100);
    mag[k] = 0;
    map.apply(mag, out);
    let owners = 0;
    for (let i = 0; i < 600; i++) if (out[i] === 0) owners++;
    claims.set(k, owners);
  }

  // Every FFT bin inside the stored range is claimed by exactly one log bin as
  // its maximum. (Neighbouring log bins may interpolate toward it, but only one
  // reports the peak value itself.)
  for (const [k, owners] of claims) {
    expect(`bin ${k}: ${owners} owners`).toBe(`bin ${k}: 1 owners`);
  }
});
