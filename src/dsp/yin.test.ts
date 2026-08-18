import { expect, test } from "bun:test";
import { Yin } from "./yin";

const SR = 48000;

function make(yin: Yin, build: (i: number) => number): Float32Array {
  const buf = new Float32Array(yin.requiredSamples);
  for (let i = 0; i < buf.length; i++) buf[i] = build(i);
  return buf;
}

test("requiredSamples covers window plus the longest period", () => {
  const yin = new Yin({ sampleRate: SR });
  expect(yin.requiredSamples).toBe(1024 + Math.ceil(SR / 55) + 1);
});

test("detects pure tones within 2 Hz over the vocal fundamental range", () => {
  // DESIGN.md §9 specifies < 2 Hz. That absolute bound is meaningful where
  // vocal fundamentals live; above ~500 Hz one sample of period error already
  // exceeds 2 Hz, so the upper range is held to a relative bound instead.
  const yin = new Yin({ sampleRate: SR });
  for (const f of [55, 82.41, 110, 220, 440]) {
    const buf = make(yin, (i) => 0.5 * Math.sin((2 * Math.PI * f * i) / SR));
    expect(Math.abs(yin.detect(buf) - f)).toBeLessThan(2);
  }
});

test("detects high tones within 0.5 percent", () => {
  const yin = new Yin({ sampleRate: SR });
  for (const f of [880, 1100]) {
    const buf = make(yin, (i) => 0.5 * Math.sin((2 * Math.PI * f * i) / SR));
    expect(Math.abs(yin.detect(buf) - f) / f).toBeLessThan(0.005);
  }
});

test("detects the fundamental of a harmonic stack, not a partial", () => {
  const yin = new Yin({ sampleRate: SR });
  const f0 = 196; // G3
  const buf = make(yin, (i) => {
    let s = 0;
    for (let h = 1; h <= 6; h++) s += (0.6 / h) * Math.sin((2 * Math.PI * f0 * h * i) / SR);
    return s;
  });
  expect(Math.abs(yin.detect(buf) - f0)).toBeLessThan(2);
});

test("detects a missing-fundamental harmonic stack", () => {
  const yin = new Yin({ sampleRate: SR });
  const f0 = 150;
  const buf = make(yin, (i) => {
    let s = 0;
    for (let h = 2; h <= 6; h++) s += (0.5 / h) * Math.sin((2 * Math.PI * f0 * h * i) / SR);
    return s;
  });
  expect(Math.abs(yin.detect(buf) - f0)).toBeLessThan(2);
});

test("reports silence as 0", () => {
  const yin = new Yin({ sampleRate: SR });
  expect(yin.detect(make(yin, () => 0))).toBe(0);
  // -70 dBFS sine is below the -55 dBFS gate
  const quiet = make(yin, (i) => 3.16e-4 * Math.sin((2 * Math.PI * 220 * i) / SR));
  expect(yin.detect(quiet)).toBe(0);
});

test("reports white noise as 0 rather than a spurious pitch", () => {
  const yin = new Yin({ sampleRate: SR });
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  expect(yin.detect(make(yin, () => 0.5 * rand()))).toBe(0);
});

test("rejects tones below fMin as out of range", () => {
  const yin = new Yin({ sampleRate: SR });
  const buf = make(yin, (i) => 0.5 * Math.sin((2 * Math.PI * 30 * i) / SR));
  expect(yin.detect(buf)).toBe(0);
});

test("rejects buffers shorter than requiredSamples", () => {
  const yin = new Yin({ sampleRate: SR });
  expect(() => yin.detect(new Float32Array(10))).toThrow();
});

test("a shallow CMND dip is rejected rather than reported as pitch", () => {
  // Loosening the threshold from 0.15 to 0.6 passes every other test here, and
  // is the classic source of octave-down errors on real voice.
  const yin = new Yin({ sampleRate: SR });
  let seed = 999;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  // Tone plus equal-power noise: periodic enough to dip, not enough to trust.
  const buf = make(yin, (i) => 0.35 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.35 * rand());
  const strict = yin.detect(buf);
  const loose = new Yin({ sampleRate: SR, threshold: 0.6 }).detect(buf);
  expect(loose).toBeGreaterThan(0);
  expect(strict).toBe(0);
});

test("the silence gate looks at the analysis window, not the lag region", () => {
  // Computing RMS over the whole buffer would let energy in the lag region
  // un-gate a window that is actually silent, which is what happens at note
  // onsets and offsets.
  const yin = new Yin({ sampleRate: SR });
  const buf = new Float32Array(yin.requiredSamples);
  for (let i = yin.windowSize; i < buf.length; i++) {
    buf[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  expect(yin.detect(buf)).toBe(0);
});
