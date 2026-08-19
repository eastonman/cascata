/**
 * Decodes an audio file to mono samples at the context's sample rate.
 *
 * `decodeAudioData` resamples to the context rate, which is what we want: the
 * stores, the analyzer, the view, and playback are all built on one sample
 * rate, and decoding at the file's native rate would mean rebuilding every one
 * of them at a second rate and resampling again on the way out. Resampling
 * artefacts sit far below the display floor.
 *
 * Channels are averaged rather than taking the first, so an imported stereo
 * file and a recording made under the `channelCount: 1` capture constraint are
 * treated the same way.
 *
 * No format allowlist: browser support differs (Safari has no OGG, Chrome
 * does), and decodeAudioData is the authority on what this browser can read.
 * Rejects with the underlying DOMException on an undecodable file.
 */
export async function decodeAudioFile(file: File, context: AudioContext): Promise<Float32Array> {
  const bytes = await file.arrayBuffer();
  const buffer = await context.decodeAudioData(bytes);

  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (channels === 0 || length === 0) return new Float32Array(0);

  const mono = new Float32Array(length);
  buffer.copyFromChannel(mono, 0);
  if (channels === 1) return mono;

  const scratch = new Float32Array(length);
  for (let c = 1; c < channels; c++) {
    buffer.copyFromChannel(scratch, c);
    for (let i = 0; i < length; i++) mono[i] += scratch[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= channels;
  return mono;
}
