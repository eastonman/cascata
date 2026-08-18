import { MAX_PLAYBACK_SECONDS } from "../config";

/**
 * Plays a range of recorded PCM and exposes a playhead in absolute sample
 * coordinates, so the view can follow it on the same index scheme the store
 * and the analyzer use.
 *
 * Playback is capped at MAX_PLAYBACK_SECONDS: with an 8-minute scrollback a
 * click near the start would otherwise begin an unstoppably long play.
 */
export class Player {
  onEnded?: () => void;

  private readonly context: AudioContext;
  private node: AudioBufferSourceNode | null = null;
  private startSample = 0;
  private startedAt = 0;
  private lengthSamples = 0;
  private rate = 0;

  constructor(context: AudioContext) {
    this.context = context;
  }

  get playing(): boolean {
    return this.node !== null;
  }

  /** Absolute sample index currently sounding, clamped to the played range. */
  get playheadSample(): number {
    if (!this.node) return this.startSample;
    const elapsed = (this.context.currentTime - this.startedAt) * this.rate;
    const offset = Math.min(this.lengthSamples, Math.max(0, Math.round(elapsed)));
    return this.startSample + offset;
  }

  play(pcm: Int16Array, sampleRate: number, startSample: number): void {
    this.stop();
    if (pcm.length === 0) return;

    const maxSamples = Math.floor(MAX_PLAYBACK_SECONDS * sampleRate);
    const length = Math.min(pcm.length, maxSamples);

    const buffer = this.context.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) channel[i] = pcm[i] / 32768;

    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.context.destination);
    node.onended = () => {
      // A manual stop() clears this.node first, so this only fires on natural end.
      if (this.node === node) {
        this.node = null;
        this.onEnded?.();
      }
    };

    this.startSample = startSample;
    this.lengthSamples = length;
    this.rate = sampleRate;
    this.startedAt = this.context.currentTime;
    this.node = node;
    node.start();
  }

  stop(): void {
    const node = this.node;
    if (!node) return;
    this.node = null;
    node.onended = null;
    try {
      node.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    node.disconnect();
  }
}
