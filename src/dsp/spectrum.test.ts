import { expect, test } from "bun:test";
import { FFT } from "./fft";
import { hann, windowSum } from "./window";
import { Spectrum } from "./spectrum";

const SR = 48000;

function sine(n: number, freq: number, sr: number, amp = 1): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

test("hann window is periodic and sums to N/2", () => {
  const w = hann(8);
  expect(w[0]).toBeCloseTo(0, 10);
  expect(windowSum(w)).toBeCloseTo(4, 5);
});

test("FFT of a unit impulse is flat", () => {
  const fft = new FFT(16);
  const re = new Float32Array(16);
  const im = new Float32Array(16);
  re[0] = 1;
  fft.forward(re, im);
  for (let k = 0; k < 16; k++) {
    expect(Math.hypot(re[k], im[k])).toBeCloseTo(1, 5);
  }
});

test("FFT of a bin-centre sine puts all energy in that bin", () => {
  const N = 64;
  const fft = new FFT(N);
  const re = sine(N, (SR * 5) / N, SR);
  const im = new Float32Array(N);
  fft.forward(re, im);
  const mags = Array.from({ length: N / 2 + 1 }, (_, k) => Math.hypot(re[k], im[k]));
  let peak = 0;
  for (let k = 1; k < mags.length; k++) if (mags[k] > mags[peak]) peak = k;
  expect(peak).toBe(5);
  expect(mags[5]).toBeCloseTo(N / 2, 3);
});

test("FFT rejects non-power-of-two sizes", () => {
  expect(() => new FFT(100)).toThrow();
});

test("full-scale sine at a bin centre reads ~0 dBFS at the right bin", () => {
  const fftSize = 4096;
  const spec = new Spectrum(fftSize);
  const targetBin = 400;
  const freq = (targetBin * SR) / fftSize;
  const out = new Float32Array(spec.binCount);
  spec.compute(sine(fftSize, freq, SR), out);

  let peak = 0;
  for (let k = 1; k < out.length; k++) if (out[k] > out[peak]) peak = k;
  expect(peak).toBe(targetBin);
  expect(out[targetBin]).toBeGreaterThan(-0.5);
  expect(out[targetBin]).toBeLessThan(0.5);
});

test("halving amplitude drops the peak by 6 dB", () => {
  const fftSize = 2048;
  const spec = new Spectrum(fftSize);
  const freq = (200 * SR) / fftSize;
  const full = new Float32Array(spec.binCount);
  const half = new Float32Array(spec.binCount);
  spec.compute(sine(fftSize, freq, SR, 1), full);
  spec.compute(sine(fftSize, freq, SR, 0.5), half);
  expect(full[200] - half[200]).toBeCloseTo(6.0206, 2);
});

test("binFreq maps bin index to frequency", () => {
  const spec = new Spectrum(4096);
  expect(spec.binCount).toBe(2049);
  expect(spec.binFreq(0, SR)).toBe(0);
  expect(spec.binFreq(2048, SR)).toBeCloseTo(SR / 2, 6);
});

test("silence reads at the floor", () => {
  const spec = new Spectrum(2048);
  const out = new Float32Array(spec.binCount);
  spec.compute(new Float32Array(2048), out);
  for (const v of out) expect(v).toBeLessThan(-150);
});

test("compute rejects a wrongly sized frame", () => {
  const spec = new Spectrum(2048);
  expect(() => spec.compute(new Float32Array(1024), new Float32Array(spec.binCount))).toThrow();
});
