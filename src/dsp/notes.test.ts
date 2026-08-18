import { expect, test } from "bun:test";
import { describeFreq, freqToMidi, midiToFreq, noteName } from "./notes";

test("A4 maps to MIDI 69 at each calibration", () => {
  expect(freqToMidi(440, 440)).toBeCloseTo(69, 10);
  expect(freqToMidi(442, 442)).toBeCloseTo(69, 10);
});

test("midiToFreq is the inverse of freqToMidi", () => {
  for (const f of [55, 110, 261.6255653, 440, 1000, 12000]) {
    expect(midiToFreq(freqToMidi(f, 440), 440)).toBeCloseTo(f, 6);
  }
});

test("note names use scientific pitch notation", () => {
  expect(noteName(69)).toBe("A4");
  expect(noteName(60)).toBe("C4");
  expect(noteName(24)).toBe("C1");
  expect(noteName(61)).toBe("C#4");
});

test("describeFreq reports nearest note and signed cents", () => {
  const exact = describeFreq(440, 440)!;
  expect(exact.name).toBe("A4");
  expect(exact.cents).toBeCloseTo(0, 6);

  const sharp = describeFreq(440 * 2 ** (25 / 1200), 440)!;
  expect(sharp.name).toBe("A4");
  expect(sharp.cents).toBeCloseTo(25, 4);

  const flat = describeFreq(440 * 2 ** (-25 / 1200), 440)!;
  expect(flat.name).toBe("A4");
  expect(flat.cents).toBeCloseTo(-25, 4);
});

test("describeFreq follows A4 calibration", () => {
  const d = describeFreq(442, 442)!;
  expect(d.name).toBe("A4");
  expect(d.cents).toBeCloseTo(0, 6);
});

test("describeFreq rejects non-positive frequencies", () => {
  expect(describeFreq(0, 440)).toBeNull();
  expect(describeFreq(-5, 440)).toBeNull();
});
