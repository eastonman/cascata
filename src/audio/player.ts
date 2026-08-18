/**
 * Plays a range of recorded PCM and exposes a playhead in absolute sample
 * coordinates, so the view can follow it on the same index scheme the store
 * and the analyzer use.
 *
 * Takes float samples, which is what AudioBuffer wants and what PcmRing.read
 * already produces — this class does no dequantisation of its own. It also
 * does not bound the range: the caller owns the MAX_PLAYBACK_SECONDS policy,
 * because that same bound decides how much it copies out of the ring.
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

  /**
   * Plays `length` samples starting at absolute index `startSample`.
   *
   * `fill` writes straight into the AudioBuffer's channel data instead of the
   * caller handing over a Float32Array it already built. At the playback cap
   * that is the difference between one 23 MB buffer and two.
   */
  playInto(
    sampleRate: number,
    startSample: number,
    length: number,
    fill: (channel: Float32Array) => void,
  ): void {
    this.stop();
    if (length <= 0) return;

    const buffer = this.context.createBuffer(1, length, sampleRate);
    fill(buffer.getChannelData(0));

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
