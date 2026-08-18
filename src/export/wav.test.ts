import { expect, test } from "bun:test";
import { encodeWav } from "./wav";

function ascii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

test("writes a canonical 16-bit mono WAV header", () => {
  const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  const buf = encodeWav(pcm, 48000);
  const v = new DataView(buf);

  expect(buf.byteLength).toBe(44 + pcm.length * 2);
  expect(ascii(v, 0, 4)).toBe("RIFF");
  expect(v.getUint32(4, true)).toBe(36 + pcm.length * 2);
  expect(ascii(v, 8, 4)).toBe("WAVE");
  expect(ascii(v, 12, 4)).toBe("fmt ");
  expect(v.getUint32(16, true)).toBe(16); // PCM subchunk size
  expect(v.getUint16(20, true)).toBe(1); // audio format = PCM
  expect(v.getUint16(22, true)).toBe(1); // channels = mono
  expect(v.getUint32(24, true)).toBe(48000); // sample rate
  expect(v.getUint32(28, true)).toBe(96000); // byte rate = sr * ch * 2
  expect(v.getUint16(32, true)).toBe(2); // block align
  expect(v.getUint16(34, true)).toBe(16); // bits per sample
  expect(ascii(v, 36, 4)).toBe("data");
  expect(v.getUint32(40, true)).toBe(pcm.length * 2);
});

test("writes samples little-endian after the header", () => {
  const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  const v = new DataView(encodeWav(pcm, 48000));
  for (let i = 0; i < pcm.length; i++) {
    expect(v.getInt16(44 + i * 2, true)).toBe(pcm[i]);
  }
});

test("handles an empty recording", () => {
  const buf = encodeWav(new Int16Array(0), 44100);
  const v = new DataView(buf);
  expect(buf.byteLength).toBe(44);
  expect(v.getUint32(4, true)).toBe(36);
  expect(v.getUint32(40, true)).toBe(0);
  expect(v.getUint32(24, true)).toBe(44100);
});

test("encodes a sample-rate-correct byte rate for other rates", () => {
  const v = new DataView(encodeWav(new Int16Array(2), 44100));
  expect(v.getUint32(24, true)).toBe(44100);
  expect(v.getUint32(28, true)).toBe(88200);
});
