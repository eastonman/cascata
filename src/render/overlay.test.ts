import { expect, test } from "bun:test";
import { formatClock, formatReadout, freqToY, yToFreq } from "./overlay";

const GEO = { h: 600, binCount: 600, maxBin: 599, fMin: 55, fMax: 12000 };

test("formatClock renders mm:ss.d", () => {
  expect(formatClock(0)).toBe("00:00.0");
  expect(formatClock(83.42)).toBe("01:23.4");
  expect(formatClock(600)).toBe("10:00.0");
});

test("formatClock handles negative times as zero", () => {
  expect(formatClock(-1)).toBe("00:00.0");
});

test("formatReadout shows time, frequency, note with cents, and level", () => {
  const s = formatReadout({ timeSec: 83.42, freq: 442, db: -31, a4: 440 });
  expect(s).toContain("01:23.4");
  expect(s).toContain("442.0 Hz");
  expect(s).toContain("A4");
  expect(s).toContain("-31 dB");
  // 442 Hz against A4=440 is about +8 cents
  expect(s).toMatch(/\+8/);
});

test("formatReadout signs negative cents", () => {
  const s = formatReadout({ timeSec: 0, freq: 438, db: -50, a4: 440 });
  expect(s).toMatch(/-7|-8/);
});

test("formatReadout omits the note for out-of-range frequencies", () => {
  const s = formatReadout({ timeSec: 0, freq: 0, db: -120, a4: 440 });
  expect(s).toContain("00:00.0");
  expect(s).not.toContain("Hz ·");
});

test("freqToY puts fMin at the bottom and the display limit at the top", () => {
  expect(freqToY(55, GEO)).toBeCloseTo(600, 3);
  expect(freqToY(12000, GEO)).toBeCloseTo(0, 3);
});

test("freqToY is logarithmic: equal octaves take equal pixels", () => {
  const a = freqToY(110, GEO) - freqToY(220, GEO);
  const b = freqToY(1760, GEO) - freqToY(3520, GEO);
  expect(a).toBeCloseTo(b, 3);
});

test("yToFreq inverts freqToY", () => {
  for (const f of [55, 220, 440, 3000, 12000]) {
    expect(yToFreq(freqToY(f, GEO), GEO)).toBeCloseTo(f, 3);
  }
});

test("a lower display limit stretches the visible range", () => {
  const cropped = { ...GEO, maxBin: 400 };
  // With a lower ceiling the same frequency sits higher up the canvas.
  expect(freqToY(440, cropped)).toBeLessThan(freqToY(440, GEO));
});
