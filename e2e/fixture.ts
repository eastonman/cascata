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

/**
 * Ten seconds of A4 with a 5 Hz, one-semitone vibrato.
 *
 * DESIGN.md 5.2 refuses to smooth the pitch curve because vibrato rate and
 * depth are what a singer is trying to see. That is an assertable claim: a
 * smoothed curve would flatten, and this fixture is what catches it.
 */
export function makeVibratoWav(sampleRate = FIXTURE_SAMPLE_RATE): Uint8Array {
  const total = sampleRate * 10;
  const pcm = new Int16Array(total);
  const rateHz = 5;
  const depth = 2 ** (1 / 12) - 1; // one semitone, as a fraction of the centre

  let phase = 0;
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const freq = 440 * (1 + depth * Math.sin(2 * Math.PI * rateHz * t));
    phase += (2 * Math.PI * freq) / sampleRate;
    pcm[i] = Math.round(0.6 * 32767 * Math.sin(phase));
  }
  return new Uint8Array(encodeWav(pcm, sampleRate));
}

/** The tones in {@link makeOctavesWav}, low to high. */
export const OCTAVE_TONES = [220, 440, 880, 1760] as const;

/** Where {@link makeOctavesWav} stops sounding and goes quiet, as a fraction. */
export const OCTAVES_SOUNDING = 2 / 3;

/**
 * Four tones an octave apart sounding together, then silence.
 *
 * The whole point of a log frequency axis is that a given musical interval
 * occupies the same vertical distance wherever it falls, which is what lets a
 * singer read the display as intervals rather than as hertz. Three equal
 * octaves stacked in one column turn that into a measurement: the gaps between
 * the bands have to come out the same.
 *
 * The silent tail is measuring equipment rather than music. The plot is not
 * only the spectrogram -- octave gridlines and the A4 reference line are drawn
 * over every column alike, and they are brighter than the tones. Subtracting a
 * silent column from a sounding one cancels them exactly, which is far steadier
 * than trying to tell them apart by colour.
 */
export function makeOctavesWav(sampleRate = FIXTURE_SAMPLE_RATE): Uint8Array {
  const total = sampleRate * FIXTURE_SECONDS;
  const sounding = Math.floor(total * OCTAVES_SOUNDING);
  const pcm = new Int16Array(total);
  const amplitude = 0.9 / OCTAVE_TONES.length;

  for (let i = 0; i < sounding; i++) {
    let sum = 0;
    for (const freq of OCTAVE_TONES) sum += Math.sin((2 * Math.PI * freq * i) / sampleRate);
    pcm[i] = Math.round(amplitude * 32767 * sum);
  }
  return new Uint8Array(encodeWav(pcm, sampleRate));
}

/** Stereo, with a different tone in each channel, to check the downmix. */
export function makeStereoWav(sampleRate = FIXTURE_SAMPLE_RATE): Uint8Array {
  // encodeWav only writes mono, so this builds the header by hand.
  const seconds = 10;
  const frames = sampleRate * seconds;
  const bytes = 44 + frames * 4;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const ascii = (off: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(off + i, t.charCodeAt(i));
  };

  ascii(0, "RIFF");
  v.setUint32(4, 36 + frames * 4, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, frames * 4, true);

  for (let i = 0; i < frames; i++) {
    const left = 0.6 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    const right = 0.6 * Math.sin((2 * Math.PI * 1760 * i) / sampleRate); // two octaves up
    v.setInt16(44 + i * 4, Math.round(left * 32767), true);
    v.setInt16(44 + i * 4 + 2, Math.round(right * 32767), true);
  }
  return new Uint8Array(buf);
}

export function writeFixture(): string {
  mkdirSync(dirname(FIXTURE_WAV), { recursive: true });
  writeFileSync(FIXTURE_WAV, makeToneWav());
  return FIXTURE_WAV;
}
