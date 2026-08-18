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
  private context: AudioContext | null;
  private readonly ownsContext: boolean;
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private legacy: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private active = false;

  constructor(context?: AudioContext) {
    this.context = context ?? null;
    this.ownsContext = !context;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  get running(): boolean {
    return this.active;
  }

  /** The live AudioContext, once start() has created it. Shared with playback. */
  get audioContext(): AudioContext | null {
    return this.context;
  }

  /** The context is created on first start and kept for playback reuse. */
  async ensureContext(): Promise<AudioContext> {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async start(onSamples: SampleSink): Promise<void> {
    if (this.active) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: CAPTURE_CONSTRAINTS });
    this.stream = stream;

    const ctx = await this.ensureContext();
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

  /** Releases the AudioContext. Only meaningful if this instance created it. */
  async dispose(): Promise<void> {
    await this.stop();
    if (this.ownsContext && this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
