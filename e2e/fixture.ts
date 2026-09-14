import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav } from "../src/export/wav";

const here = dirname(fileURLToPath(import.meta.url));

/** Written by global-setup; Chromium's fake audio device needs a real path. */
export const FIXTURE_WAV = join(here, ".fixtures", "tone.wav");

export const FIXTURE_SAMPLE_RATE = 48000;

/** Long enough to span a desktop viewport at the default 1 px per column. */
export const FIXTURE_SECONDS = 30;

/**
 * Thirty seconds: ten of A4, ten of silence, ten of A5.
 *
 * Assertions can then be about musical facts rather than pixel luck. The
 * silence in the middle is what makes "the pitch curve breaks rather than
 * bridging a gap" checkable, and the octave gives two clearly separated
 * heights on a log frequency axis.
 *
 * The length is not arbitrary. At 1 px per column and 46.9 columns a second, a
 * short clip occupies only a few hundred pixels of a 1280-pixel canvas and
 * sits against the right edge, so "the left third" and "the right third" stop
 * meaning what the test intends. Thirty seconds fills the plot on any
 * reasonable viewport.
 */
export function makeToneWav(sampleRate = FIXTURE_SAMPLE_RATE): Uint8Array {
  const third = sampleRate * (FIXTURE_SECONDS / 3);
  const pcm = new Int16Array(sampleRate * FIXTURE_SECONDS);

  const write = (from: number, to: number, freq: number) => {
    for (let i = from; i < to; i++) {
      pcm[i] = Math.round(0.6 * 32767 * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    }
  };
  write(0, third, 440);
  // The middle third stays silent.
  write(2 * third, pcm.length, 880);

  return new Uint8Array(encodeWav(pcm, sampleRate));
}

export function writeFixture(): string {
  mkdirSync(dirname(FIXTURE_WAV), { recursive: true });
  writeFileSync(FIXTURE_WAV, makeToneWav());
  return FIXTURE_WAV;
}
