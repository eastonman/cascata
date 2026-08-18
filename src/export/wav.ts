const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Canonical 44-byte RIFF/WAVE header followed by 16-bit mono little-endian PCM.
 *
 * Pure and synchronous so it can be unit-tested; triggering the actual save is
 * the platform layer's job (DESIGN.md §8).
 */
export function encodeWav(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8, true); // byte rate
  view.setUint16(32, (CHANNELS * BITS_PER_SAMPLE) / 8, true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(HEADER_BYTES + i * 2, pcm[i], true);
  }

  return buffer;
}
