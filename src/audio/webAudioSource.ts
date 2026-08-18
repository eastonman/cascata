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
  private readonly context: AudioContext;
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private legacy: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private active = false;

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
    if (this.active) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: CAPTURE_CONSTRAINTS });
    this.stream = stream;

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

    this.active = true;
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;

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
