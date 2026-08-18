import { CAPTURE_CONSTRAINTS, type AudioSource, type SampleSink } from "./source";

const SCRIPT_PROCESSOR_BUFFER = 1024;

/**
 * getUserMedia + AudioWorklet capture.
 *
 * Falls back to ScriptProcessorNode where AudioWorklet is missing — deprecated,
 * but it is the only capture path on older Android System WebViews, and the
 * API baseline in DESIGN.md §2.3 keeps it in scope.
 *
 * The capture node is connected to a muted gain node into the destination
 * because some engines (Safari in particular) will not pull from a graph whose
 * output is not connected to anything.
 */
export class WebAudioSource implements AudioSource {
  onUnexpectedStop?: () => void;
  onProcessingNotDisabled?: (stuck: readonly string[]) => void;

  private readonly context: AudioContext;
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private legacy: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private active = false;
  /**
   * Set synchronously, unlike `active`, which cannot be set until after two
   * awaits. Without it a second click during the permission prompt runs the
   * whole setup concurrently: the two chains overwrite each other's node
   * fields, both worklets end up feeding the sink, every chunk is written to
   * the ring twice, and the first MediaStream becomes unreachable — the mic
   * stays on for the life of the page.
   */
  private starting = false;

  /** The context is owned by the caller, which also needs it for playback. */
  constructor(context: AudioContext) {
    this.context = context;
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  get running(): boolean {
    return this.active;
  }

  async start(onSamples: SampleSink): Promise<void> {
    if (this.active || this.starting) return;
    this.starting = true;
    try {
      await this.startInner(onSamples);
    } finally {
      this.starting = false;
    }
  }

  private async startInner(onSamples: SampleSink): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: CAPTURE_CONSTRAINTS });
    this.stream = stream;

    // Everything past this point can fail with the microphone already open:
    // addModule can be blocked by CSP or fail to fetch the worklet chunk, which
    // is exactly the Android WebView risk in DESIGN.md §2.4. Without this
    // teardown the track stays live, the browser's recording indicator stays
    // lit for the rest of the session, and a retry orphans the first stream.
    try {
      const ctx = this.context;
      this.input = ctx.createMediaStreamSource(stream);
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(ctx.destination);

      if (typeof AudioWorkletNode === "function" && ctx.audioWorklet) {
        await ctx.audioWorklet.addModule(new URL("./capture-worklet.js", import.meta.url));
        const node = new AudioWorkletNode(ctx, "capture-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data);
        this.input.connect(node);
        node.connect(this.sink);
        this.worklet = node;
      } else {
        const node = ctx.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 1, 1);
        node.onaudioprocess = (event) => {
          // The event buffer is reused by the engine, so copy before handing it on.
          onSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        this.input.connect(node);
        node.connect(this.sink);
        this.legacy = node;
      }
    } catch (err) {
      this.teardown();
      throw err;
    }

    this.active = true;

    // The three constraints are advisory: a UA that cannot honour them
    // succeeds silently, and iOS Safari has shipped builds that ignore
    // autoGainControl. Since AGC is the exact distortion DESIGN.md §5.3 exists
    // to prevent, report it rather than let the user trust the display.
    const settings = stream.getAudioTracks()[0]?.getSettings() as
      | { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean }
      | undefined;
    if (settings) {
      const stuck = (["echoCancellation", "noiseSuppression", "autoGainControl"] as const).filter(
        (k) => settings[k] === true,
      );
      if (stuck.length > 0) this.onProcessingNotDisabled?.(stuck);
    }

    // A track can end without us stopping it: the device is unplugged, or
    // another app preempts it. Without this the UI would keep saying
    // "Recording" over a frozen waterfall.
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (this.active) void this.stop().then(() => this.onUnexpectedStop?.());
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.teardown();
  }

  /** Disconnects and releases everything start() may have created. Safe to call twice. */
  private teardown(): void {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    if (this.legacy) {
      this.legacy.onaudioprocess = null;
      this.legacy.disconnect();
      this.legacy = null;
    }
    this.input?.disconnect();
    this.input = null;
    this.sink?.disconnect();
    this.sink = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

}
