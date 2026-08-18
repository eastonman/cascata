/**
 * Capture constraints. All three processors must be off: AGC in particular
 * rewrites level over time, which is the most common source of misleading
 * intensity in this kind of tool (DESIGN.md §5.3).
 */
export const CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export type SampleSink = (chunk: Float32Array) => void;

/**
 * Audio capture behind an interface so the whole DSP and render path stays
 * independent of how samples arrive. If a WebView turns out to capture badly,
 * a native source can be substituted here without touching anything else
 * (DESIGN.md §2.4).
 */
export interface AudioSource {
  readonly sampleRate: number;
  readonly running: boolean;
  start(onSamples: SampleSink): Promise<void>;
  stop(): Promise<void>;
}
