import { expect, test } from "bun:test";
import { PcmRing } from "./pcmRing";

test("tracks absolute write index and earliest valid index", () => {
  const ring = new PcmRing(10);
  expect(ring.writeIndex).toBe(0);
  expect(ring.earliestIndex).toBe(0);
  ring.write(new Float32Array(6));
  expect(ring.writeIndex).toBe(6);
  expect(ring.earliestIndex).toBe(0);
  ring.write(new Float32Array(8));
  expect(ring.writeIndex).toBe(14);
  expect(ring.earliestIndex).toBe(4);
});

test("reads back what was written", () => {
  const ring = new PcmRing(100);
  const src = Float32Array.from({ length: 50 }, (_, i) => (i % 21) / 20 - 0.5);
  ring.write(src);
  const out = new Float32Array(50);
  expect(ring.read(0, out)).toBe(50);
  for (let i = 0; i < 50; i++) expect(out[i]).toBeCloseTo(src[i], 4);
});

test("reads across a wrap boundary", () => {
  const ring = new PcmRing(8);
  ring.write(Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
  ring.write(Float32Array.from([0.7, 0.8, 0.9, 1.0]));
  const out = new Float32Array(8);
  expect(ring.read(2, out)).toBe(8);
  const expected = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  for (let i = 0; i < 8; i++) expect(out[i]).toBeCloseTo(expected[i], 4);
});

test("returns 0 for fully evicted or future ranges", () => {
  const ring = new PcmRing(8);
  ring.write(new Float32Array(20));
  const out = new Float32Array(4);
  expect(ring.read(0, out)).toBe(0);
  expect(ring.read(100, out)).toBe(0);
});

test("zero-fills a partially available tail", () => {
  const ring = new PcmRing(16);
  ring.write(Float32Array.from([0.5, 0.5, 0.5, 0.5]));
  const out = new Float32Array(6);
  expect(ring.read(2, out)).toBe(2);
  expect(out[0]).toBeCloseTo(0.5, 4);
  expect(out[1]).toBeCloseTo(0.5, 4);
  expect(out[2]).toBe(0);
  expect(out[5]).toBe(0);
});

test("zero-fills a partially evicted head", () => {
  const ring = new PcmRing(8);
  ring.write(Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]));
  expect(ring.earliestIndex).toBe(2);
  const out = new Float32Array(4);
  expect(ring.read(0, out)).toBe(2);
  expect(out[0]).toBe(0);
  expect(out[1]).toBe(0);
  expect(out[2]).toBeCloseTo(0.3, 4);
  expect(out[3]).toBeCloseTo(0.4, 4);
});

test("clamps out-of-range float samples", () => {
  const ring = new PcmRing(4);
  ring.write(Float32Array.from([2, -2, 0, 1]));
  const raw = ring.readInt16(0, 4);
  expect(raw[0]).toBe(32767);
  expect(raw[1]).toBe(-32768);
  expect(raw[2]).toBe(0);
  expect(raw[3]).toBe(32767);
});

test("handles chunks larger than capacity", () => {
  const ring = new PcmRing(4);
  ring.write(Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
  expect(ring.writeIndex).toBe(6);
  expect(ring.earliestIndex).toBe(2);
  const out = new Float32Array(4);
  expect(ring.read(2, out)).toBe(4);
  expect(out[0]).toBeCloseTo(0.3, 4);
  expect(out[3]).toBeCloseTo(0.6, 4);
});

test("readInt16 clips the request to the valid range", () => {
  const ring = new PcmRing(8);
  ring.write(Float32Array.from([0.1, 0.2, 0.3, 0.4]));
  expect(ring.readInt16(0, 4).length).toBe(4);
  expect(ring.readInt16(2, 10).length).toBe(10);
  expect(ring.readInt16(2, 10)[2]).toBe(0);
});

test("clear resets indices and contents", () => {
  const ring = new PcmRing(8);
  ring.write(new Float32Array(8).fill(0.5));
  ring.clear();
  expect(ring.writeIndex).toBe(0);
  expect(ring.earliestIndex).toBe(0);
  expect(ring.read(0, new Float32Array(4))).toBe(0);
});
