import { decodeAudioFile } from "../audio/decodeFile";
import { Player } from "../audio/player";
import type { AudioSource } from "../audio/source";
import { WebAudioSource } from "../audio/webAudioSource";
import {
  ANALYSIS_BUDGET_MS,
  HOP,
  IMPORT_WARN_BYTES,
  MAX_IMPORT_BYTES,
  MAX_PLAYBACK_SECONDS,
  RECORD_SECONDS,
} from "../config";
import { encodeWav } from "../export/wav";
import { saveBlob } from "../platform/files";
import { loadSettings, type Settings, saveSettings } from "../platform/settings";
import { formatClock } from "../render/overlay";
import { planImportCapacity, storeBytesPerSecond } from "../store/capacity";
import { type ControlsHandle, createControls } from "./controls";
import { Pane } from "./pane";
import { equivalentSample, linkOffset, mirrorView } from "./paneLink";
import {
  INITIAL_SELECTION,
  other,
  type PaneIndex,
  type Selection,
  setActive as selectActive,
  setArmed as selectArmed,
  setCompare as selectCompare,
  setLinked as selectLinked,
} from "./paneSelection";
import { type PaneStatus, statusText } from "./statusText";

/**
 * Orchestrates one or two panes and everything they share.
 *
 * The device is shared and the panes are not: there is one AudioContext, one
 * AudioSource, and one Player here, while each Pane owns its own audio,
 * analysis, view, and canvas. Routing capture to the *armed* pane is what makes
 * "both panes recording at once" unrepresentable rather than merely forbidden.
 */
export class App {
  private readonly panesEl: HTMLDivElement;
  private readonly controls: ControlsHandle;
  private readonly panes: [Pane, Pane];

  private settings: Settings;
  private audioContext: AudioContext | null = null;
  private source: AudioSource | null = null;
  private player: Player | null = null;

  /** Which pane is shown, focused, armed, and linked. Rules live in paneSelection. */
  private selection: Selection = INITIAL_SELECTION;
  private linkOffsetCols = 0;
  private playingPane: PaneIndex | null = null;

  private capturing = false;
  private importing = false;
  private wakeLock: WakeLockSentinel | null = null;
  private frame = 0;
  private lastFollowing = true;
  private lastStatus = "";
  private statusHoldUntil = 0;
  private heldText = "";

  constructor(root: HTMLElement) {
    this.settings = loadSettings();

    this.controls = createControls(root, this.settings, {
      onToggleCapture: () => void this.toggleCapture(),
      onTogglePlay: () => void this.togglePlay(),
      onFollow: () => this.followActive(),
      onExport: () => this.exportWav(),
      onToggleCompare: () => this.setCompare(!this.compare),
      onToggleLink: () => this.setLinked(!this.linked),
      onSettingsChange: (patch) => this.applySettings(patch),
    });

    this.panesEl = document.createElement("div");
    this.panesEl.id = "panes";
    root.append(this.panesEl);

    const callbacks = {
      onImport: (pane: Pane, file: File) => void this.importFile(pane, file),
      onClear: (pane: Pane) => this.clearPane(pane),
      onArm: (pane: Pane) => this.setArmed(this.indexOf(pane)),
      onViewChanged: (pane: Pane) => this.mirrorFrom(this.indexOf(pane)),
      onActivate: (pane: Pane) => this.setActive(this.indexOf(pane)),
    };
    this.panes = [new Pane("A", callbacks, this.settings), new Pane("B", callbacks, this.settings)];
    for (const pane of this.panes) this.panesEl.append(pane.root);

    this.setCompare(false);
    this.setLinked(false);
    this.setArmed(0);
    this.setActive(0);
    this.applyLayout();

    this.controls.setCaptureState(false);
    this.controls.setPlayState(false);
    this.controls.setExportEnabled(false);
    this.controls.setPlayEnabled(false);
    for (const pane of this.panes) pane.refreshHeader();

    this.bindKeyboard();
    this.bindResize();
    this.bindVisibility();
  }

  start(): void {
    this.resizeAll();
    const loop = () => {
      this.tick();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  // --- pane bookkeeping ----------------------------------------------------

  private get compare(): boolean {
    return this.selection.compare;
  }

  private get linked(): boolean {
    return this.selection.linked;
  }

  private get active(): PaneIndex {
    return this.selection.active;
  }

  private get armed(): PaneIndex {
    return this.selection.armed;
  }

  private indexOf(pane: Pane): PaneIndex {
    return pane === this.panes[0] ? 0 : 1;
  }

  private get activePane(): Pane {
    return this.panes[this.active];
  }

  /** Panes taking part right now: both in compare mode, otherwise just A. */
  private get livePanes(): Pane[] {
    return this.compare ? [this.panes[0], this.panes[1]] : [this.panes[0]];
  }

  private setActive(index: PaneIndex): void {
    this.selection = selectActive(this.selection, index);
  }

  private setArmed(index: PaneIndex): void {
    this.selection = selectArmed(this.selection, index, this.capturing);
    this.panes[0].setArmed(this.armed === 0);
    this.panes[1].setArmed(this.armed === 1);
  }

  private setCompare(on: boolean): void {
    // Visibility and layout only -- never lifetime. Pane B keeps its audio so
    // leaving compare mode cannot silently discard an imported file; Clear is
    // the only thing in this app that destroys audio.
    this.selection = selectCompare(this.selection, on);
    this.panes[1].setVisible(this.compare);
    this.controls.setCompareState(this.compare);
    this.controls.setLinkAvailable(this.compare);
    this.controls.setLinkState(this.linked);
    this.setArmed(this.armed);
    this.resizeAll();
  }

  private setLinked(on: boolean): void {
    const a = this.panes[0].viewState;
    const b = this.panes[1].viewState;
    if (on && a && b) {
      // Freeze whatever alignment the user has already dragged into place, so
      // pressing Link never moves anything.
      this.linkOffsetCols = linkOffset(a, b);
    }
    this.selection = selectLinked(this.selection, on);
    this.controls.setLinkState(this.linked);
  }

  /** Propagates a pan or zoom from `index` to the other pane while linked. */
  private mirrorFrom(index: PaneIndex): void {
    this.setActive(index);
    if (!this.linked) return;
    const master = this.panes[index].viewState;
    const follower = this.panes[other(index)].viewState;
    if (!master || !follower) return;

    const offset = index === 0 ? this.linkOffsetCols : -this.linkOffsetCols;
    const correction = mirrorView(master, follower, offset);
    // The follower ran out of its own history before the master did. Pull the
    // master back rather than letting the two drift apart -- a link that
    // silently stops holding is worse than one that stops scrolling.
    if (correction !== 0) master.panColumns(correction);
  }

  private followActive(): void {
    this.activePane.viewState?.follow();
    this.mirrorFrom(this.active);
  }

  // --- capture -------------------------------------------------------------

  private async toggleCapture(): Promise<void> {
    if (this.capturing && this.source) {
      await this.source.stop();
      this.capturing = false;
      this.controls.setCaptureState(false);
      this.notify("Stopped", 2000);
      this.refreshEnabled();
      void this.releaseWakeLock();
      return;
    }

    const target = this.panes[this.armed];
    let source: AudioSource;
    try {
      this.audioContext ??= new AudioContext();
      // Not `=== "suspended"`: WebKit also has a non-standard "interrupted"
      // state after a phone call or a route change, and a context left in it
      // accepts getUserMedia and delivers no samples at all.
      if (this.audioContext.state !== "running") await this.audioContext.resume();
      if (!this.source) {
        const web = new WebAudioSource(this.audioContext);
        web.onUnexpectedStop = () => this.handleUnexpectedStop();
        web.onProcessingNotDisabled = (stuck) =>
          this.notify(
            `Warning: this device would not disable ${stuck.join(", ")} — levels are unreliable`,
          );
        this.source = web;
      }
      source = this.source;
      await source.start((chunk) => target.writeSamples(chunk));
    } catch (err) {
      this.notify(`Could not start capture: ${(err as Error).message}`);
      return;
    }

    // Rebuild when the rate changed, and also when this pane was last holding
    // an import: its ring is sized to that file, and recording into it would
    // quietly put the recording path above the DESIGN.md §1.2 budget.
    if (target.sampleRate !== source.sampleRate || target.capacitySeconds !== RECORD_SECONDS) {
      target.build(source.sampleRate, RECORD_SECONDS, this.settings);
    }
    this.ensurePlayer();

    this.capturing = true;
    this.setActive(this.armed);
    this.controls.setCaptureState(true);
    this.refreshEnabled();
    void this.acquireWakeLock();
  }

  /** The device went away on its own; keep the UI honest about it. */
  private handleUnexpectedStop(): void {
    if (!this.capturing) return;
    this.capturing = false;
    this.controls.setCaptureState(false);
    this.notify("Capture stopped: the microphone became unavailable");
    this.refreshEnabled();
    void this.releaseWakeLock();
  }

  // --- import and clear ----------------------------------------------------

  private async importFile(pane: Pane, file: File): Promise<void> {
    if (this.importing) return;
    if (this.capturing && pane === this.panes[this.armed]) {
      this.notify("Stop recording before importing into this pane", 3000);
      return;
    }
    this.importing = true;
    for (const p of this.panes) p.setImportEnabled(false);
    this.notify(`Decoding ${file.name}…`, 60000);

    try {
      // A file picker click is a user gesture, so a context can be created here
      // even if capture has never run.
      this.audioContext ??= new AudioContext();
      if (this.audioContext.state !== "running") await this.audioContext.resume();

      // Decode before tearing anything down: a failed import must never cost
      // the user the recording they already have.
      const samples = await decodeAudioFile(file, this.audioContext);
      if (samples.length === 0) {
        this.notify(`${file.name} contains no audio`);
        return;
      }

      const rate = this.audioContext.sampleRate;
      const duration = samples.length / rate;
      const plan = planImportCapacity(duration, rate, MAX_IMPORT_BYTES);
      if (plan.seconds <= 0) {
        this.notify("Import budget is too small for this file");
        return;
      }
      if (plan.bytes > IMPORT_WARN_BYTES) {
        this.notify(
          `Importing ${formatClock(plan.seconds)} — about ${Math.round(plan.bytes / 1024 ** 2)} MB, which may fail on a phone…`,
          60000,
        );
      }

      if (!this.allocate(pane, rate, plan.seconds)) {
        this.notify("Not enough memory for this file, even reduced");
        return;
      }
      this.ensurePlayer();

      const kept = Math.min(samples.length, Math.ceil(pane.capacitySeconds * rate));
      pane.writeSamples(kept === samples.length ? samples : samples.subarray(0, kept));
      // A file is read from its start, so pin there rather than following the
      // end the way a live recording does.
      pane.showFromStart(Math.ceil(kept / HOP));

      this.setActive(this.indexOf(pane));
      const truncated = plan.truncated || kept < samples.length;
      this.notify(
        truncated
          ? `${pane.label}: imported first ${formatClock(kept / rate)} of ${formatClock(duration)}`
          : `${pane.label}: imported ${formatClock(duration)} from ${file.name}`,
        10000,
      );
    } catch (err) {
      this.notify(`Could not read ${file.name}: ${(err as Error).message}`);
    } finally {
      this.importing = false;
      this.refreshEnabled();
    }
  }

  /**
   * Builds a pane's stores, backing off when the engine refuses.
   *
   * A RangeError from a large typed array is catchable and worth retrying
   * smaller. The other failure mode — iOS killing the tab under memory
   * pressure — produces no error at all and cannot be handled from here.
   */
  private allocate(pane: Pane, rate: number, seconds: number): boolean {
    for (const fraction of [1, 0.5, 0.25]) {
      try {
        pane.build(rate, seconds * fraction, this.settings);
        return true;
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
      }
    }
    return false;
  }

  private clearPane(pane: Pane): void {
    if (this.capturing && pane === this.panes[this.armed]) return;
    if (this.playingPane === this.indexOf(pane)) {
      this.player?.stop();
      this.playingPane = null;
      this.controls.setPlayState(false);
    }
    pane.clear();
    this.notify(`${pane.label}: cleared`, 3000);
    this.refreshEnabled();
  }

  // --- settings ------------------------------------------------------------

  private applySettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    for (const pane of this.panes) pane.applySettings(patch, this.settings);
    if (patch.timeZoom !== undefined) this.mirrorFrom(this.active);
    if (patch.paneLayout !== undefined) this.applyLayout();
  }

  /** Pure layout: no store is rebuilt and no column recomputed. */
  private applyLayout(): void {
    this.panesEl.dataset.layout = this.settings.paneLayout;
    this.resizeAll();
  }

  // --- playback and export -------------------------------------------------

  private ensurePlayer(): void {
    if (this.player || !this.audioContext) return;
    this.player = new Player(this.audioContext);
    this.player.onEnded = () => {
      this.playingPane = null;
      this.controls.setPlayState(false);
    };
  }

  private async togglePlay(): Promise<void> {
    if (this.player?.playing) {
      this.player.stop();
      this.playingPane = null;
      this.controls.setPlayState(false);
      return;
    }
    const pane = this.activePane;
    const cursor = pane.cursorCol;
    const range = pane.pcmRange;
    if (!range) {
      this.notify("Nothing to play yet", 3000);
      return;
    }
    const from = cursor !== null ? cursor * HOP : range.earliest;
    await this.playFrom(this.active, Math.max(range.earliest, from));
  }

  private async playFrom(index: PaneIndex, startSample: number): Promise<void> {
    const pane = this.panes[index];
    const range = pane.pcmRange;
    this.ensurePlayer();
    if (!this.player || !range) return;

    const start = Math.min(Math.max(range.earliest, startSample), range.writeIndex);
    // This bound is both the DESIGN.md §7 playback cap and the size of the
    // buffer copied out of the ring, which is why it lives here not in Player.
    const count = Math.min(
      range.writeIndex - start,
      Math.floor(MAX_PLAYBACK_SECONDS * pane.sampleRate),
    );
    if (count <= 0) {
      this.notify("Nothing to play yet", 3000);
      return;
    }

    // Same reason as capture: starting a source on a non-running context
    // produces silence and never fires onended, leaving the button stuck.
    if (this.audioContext && this.audioContext.state !== "running") {
      await this.audioContext.resume();
    }

    this.player.playInto(pane.sampleRate, start, count, (channel) =>
      pane.fillSamples(start, channel),
    );
    this.playingPane = index;
    this.controls.setPlayState(true);
  }

  /**
   * Moves focus to the other pane, continuing playback at the matching moment.
   *
   * One key for both states: switching panes and auditioning A against B are
   * the same intent, and splitting them across two keys means remembering which
   * is which mid-comparison.
   */
  private switchPane(): void {
    if (!this.compare) return;
    const next = other(this.active);

    if (this.player?.playing && this.playingPane !== null) {
      const head = this.player.playheadSample;
      const direction = this.playingPane === 0 ? 1 : -1;
      const target = equivalentSample(head, direction, this.linkOffsetCols, this.linked);
      // Keep the cursor in step so stopping and replaying resumes here.
      this.panes[next].showCursorAt(Math.floor(target / HOP));
      void this.playFrom(next, target);
    }

    this.setActive(next);
    this.notify(`${this.panes[next].label} active`, 1500);
  }

  private exportWav(): void {
    const pane = this.activePane;
    const range = pane.pcmRange;
    const count = range ? range.writeIndex - range.earliest : 0;
    if (!range || count <= 0) {
      this.notify("Nothing recorded to export", 3000);
      return;
    }
    const pcm = pane.readInt16(range.earliest, count);
    if (!pcm) return;

    const blob = new Blob([encodeWav(pcm, pane.sampleRate)], { type: "audio/wav" });
    saveBlob(blob, `cascata-${pane.label}-${Math.round(count / pane.sampleRate)}s.wav`);
  }

  // --- input ---------------------------------------------------------------

  private bindKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;

      const view = this.activePane.viewState;
      switch (e.key) {
        case " ":
          e.preventDefault();
          void this.togglePlay();
          break;
        case "Tab":
          e.preventDefault();
          this.switchPane();
          break;
        case "Escape":
          this.player?.stop();
          this.playingPane = null;
          this.controls.setPlayState(false);
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          if (!view) return;
          e.preventDefault();
          const step = Math.max(1, Math.round(view.visibleCols / 10)) * (e.shiftKey ? 5 : 1);
          view.panColumns(e.key === "ArrowLeft" ? -step : step);
          this.mirrorFrom(this.active);
          break;
        }
      }
    });
  }

  private bindResize(): void {
    const observer = new ResizeObserver(() => this.resizeAll());
    for (const pane of this.panes) observer.observe(pane.root);
    window.addEventListener("resize", () => this.resizeAll());
  }

  private resizeAll(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const pane of this.livePanes) pane.resize(dpr);
  }

  private bindVisibility(): void {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.capturing) void this.acquireWakeLock();
    });
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // Denied, unsupported, or the tab is hidden. Capture is unaffected.
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      // Already released.
    }
    this.wakeLock = null;
  }

  // --- draw loop -----------------------------------------------------------

  private tick(): void {
    const live = this.livePanes;

    // Split the frame budget between panes that still owe analysis, so two
    // simultaneous imports cost one frame's work rather than two.
    const busy = live.filter((p) => p.backlogColumns > 0);
    const share = busy.length > 0 ? ANALYSIS_BUDGET_MS / busy.length : 0;
    for (const pane of busy) pane.pump(share);

    const hoverCols = live.map((p) => p.hoveredCol);
    for (let i = 0; i < live.length; i++) {
      const pane = live[i];
      const otherHover = live.length === 2 ? hoverCols[i === 0 ? 1 : 0] : null;
      pane.draw(this.settings, {
        active: this.compare && pane === this.activePane,
        ghostCol: otherHover === null ? null : this.translateCol(otherHover, i === 0 ? -1 : 1),
        playheadCol:
          this.player?.playing && this.playingPane === this.indexOf(pane)
            ? Math.floor(this.player.playheadSample / HOP)
            : null,
      });
      pane.refreshHeader();
    }

    const following = this.activePane.viewState?.following ?? true;
    if (following !== this.lastFollowing) {
      this.lastFollowing = following;
      this.controls.setFollowState(following);
    }
    this.updateStatus();
  }

  /** A column in one pane expressed in the other's timeline. */
  private translateCol(col: number, direction: 1 | -1): number {
    return this.linked ? col + direction * this.linkOffsetCols : col;
  }

  // --- status --------------------------------------------------------------

  /**
   * Shows a message the draw loop will not immediately overwrite.
   *
   * updateStatus runs every frame, so a plain setStatus is invisible: it is
   * replaced before it can be read.
   */
  private notify(text: string, holdMs = 6000): void {
    this.statusHoldUntil = performance.now() + holdMs;
    this.heldText = text;
    this.lastStatus = text;
    this.controls.setStatus(text);
  }

  private refreshEnabled(): void {
    for (const pane of this.panes) {
      const armedAndRecording = this.capturing && pane === this.panes[this.armed];
      pane.setImportEnabled(!this.importing && !armedAndRecording);
      pane.refreshHeader();
    }
    const has = this.activePane.hasData;
    this.controls.setPlayEnabled(has);
    this.controls.setExportEnabled(has);
  }

  /** Collects what the status bar needs; statusText decides what it says. */
  private paneStatus(pane: Pane): PaneStatus {
    return {
      label: pane.label,
      hasData: pane.hasData,
      analysisProgress: pane.analysisProgress,
      backlogColumns: pane.backlogColumns,
      durationSeconds: pane.model.durationSeconds,
      following: pane.viewState?.following ?? true,
      bytes: pane.sampleRate > 0 ? pane.capacitySeconds * storeBytesPerSecond(pane.sampleRate) : 0,
    };
  }

  private updateStatus(): void {
    const text = statusText({
      panes: this.livePanes.map((p) => this.paneStatus(p)),
      activeIndex: this.compare ? this.active : 0,
      capturing: this.capturing,
      compare: this.compare,
      linked: this.linked,
      held: this.heldText ? { text: this.heldText, until: this.statusHoldUntil } : null,
      now: performance.now(),
      memoryNoticeBytes: IMPORT_WARN_BYTES,
    });
    // Null means a transient message still owns the bar.
    if (text === null || text === this.lastStatus) return;
    this.lastStatus = text;
    this.controls.setStatus(text);
  }
}
