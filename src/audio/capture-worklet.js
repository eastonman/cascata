/**
 * Batches the render quantum (128 frames) up to the analysis hop before
 * posting, so the main thread wakes ~47 times a second instead of ~375.
 *
 * Plain JS on purpose: this file is loaded by addModule() as a separate
 * module graph, outside the TypeScript build.
 */
const BATCH = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(BATCH);
    this._n = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n === BATCH) {
        const out = this._buf.slice();
        this.port.postMessage(out, [out.buffer]);
        this._n = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
