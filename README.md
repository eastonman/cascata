# Cascata

A real-time waterfall spectrogram for vocal training. Sing into your
microphone and watch the harmonic structure of your voice scroll past —
pitch, vibrato, onset, and resonance are all directly visible.

It runs entirely in the browser. Nothing is uploaded, and nothing is stored
unless you explicitly export it.

## Using it

Open the page, allow microphone access, and press **Record**.

The waterfall scrolls right to left on a logarithmic frequency axis, with
C1–C9 gridlines and an A4 reference line for pitch reference. Intensity is
colour. A YIN-derived pitch curve is overlaid on top.

| Action | How |
|---|---|
| Start / stop capture | **Record** |
| Look back through history | Drag the canvas. Recording continues while you browse. |
| Return to the live edge | **Follow** |
| Set the playback cursor | Click (or tap) the canvas |
| Play from the cursor | **Play**, or <kbd>Space</kbd> |
| Stop playback | <kbd>Esc</kbd> |
| Pan | <kbd>←</kbd> / <kbd>→</kbd>, hold <kbd>Shift</kbd> to go faster |
| Read a point | Hover for time, frequency, note ± cents, and level |
| Save the audio | **Export WAV** |

### Settings

All of these are saved across reloads, and none of them touch the recorded
audio — changing one never costs you what you have already sung.

- **Window** — FFT length, 2048 / 4096 / 8192. Longer resolves pitch better and
  time worse. Only affects columns drawn after the change.
- **Max freq** — display ceiling, 2 / 5 / 8 / 12 kHz. Crops the view; the data
  above it is still stored.
- **Colors** — magma, viridis, or gray. The first two are perceptually uniform,
  so a step in dB reads as the same step in brightness anywhere in the range.
- **Zoom** — 0.5× to 4× horizontal.
- **Floor** / **Range** — the dB window mapped onto the colormap. Lower the
  floor to see quiet detail, raise it to cut room noise.
- **A4** — 440 / 442 / 443 Hz. Moves the note gridlines and the cents readout.
- **Pitch** — show or hide the YIN curve.

### Things worth knowing

- **The last 8 minutes are kept**, then the oldest audio is overwritten. Export
  before you lose something you want.
- **Nothing is persisted.** Closing the tab discards the recording.
- **The pitch curve is deliberately unsmoothed.** Vibrato rate and depth are
  things you are trying to observe, and smoothing would flatten them. Octave
  jumps are YIN's known failure mode and are shown rather than hidden.
- **Automatic gain control is disabled** on the microphone, so brightness
  really does track loudness. If your device refuses to turn it off, the status
  bar says so — do not trust intensity readings in that case.
- **Playback is capped at 120 seconds** from the cursor.

### Browser support

Chrome and Safari on desktop, and mobile browsers. `getUserMedia` requires a
secure context, so a plain-HTTP address on your LAN will not work — use
`localhost`, a tunnel, or a local HTTPS certificate.

## Developing

The toolchain is pinned by a Nix flake. You need Nix with flakes enabled;
everything else comes from the flake.

```sh
nix develop                 # bun 1.3 + node 24
bun install
bun run dev                 # http://localhost:5173
```

With [direnv](https://direnv.net/), `direnv allow` loads the shell
automatically — `.envrc` is already in the repo.

```sh
bun test                    # unit tests
bun run typecheck           # tsc --noEmit
bun run check               # biome format + lint check
bun run format              # biome format --write
bun run build               # typecheck + production build to dist/
```

### Layout

```
src/
  config.ts     analysis and storage constants
  dsp/          FFT, windowing, log binning, YIN, note names — pure functions
  store/        PCM ring buffer, spectrum column store — pure data structures
  analysis/     Analyzer: derives columns and f0 from PCM
  audio/        AudioSource interface, Web Audio capture, playback
  render/       colormap, waterfall renderer, overlays
  platform/     settings and file-save adapters
  export/       WAV encoder
  ui/           view state, controls, app shell and draw loop
```

Dependencies flow one way: `ui → analysis / render / audio / platform → store / dsp`.
`dsp/` and `store/` import nothing above themselves, which is what makes them
testable as plain functions.

Two rules are worth stating because breaking them is easy and the damage is
quiet:

1. **Recorded PCM is the only source of truth.** Spectrum columns and pitch
   values are derived from it and can be thrown away and recomputed. Capture
   writes samples and nothing else.
2. **Sample and column indices are absolute and never reset.** Ring buffer
   overwriting is expressed by `earliestIndex` moving forward. This is what
   keeps the time axis correct after the buffer wraps.

Anything platform-specific — file saving, settings persistence — lives behind
`src/platform/`. Nothing outside it may touch `localStorage` or create download
anchors.

### Testing

`bun test` covers the pure layers: DSP numerics, the stores, the analyzer's
time grid, the WAV header, settings validation, and the view-state interaction
rules. 116 tests.

Rendering and interaction are **not** covered automatically. There is a manual
checklist for them; ask for `docs/manual-verification.md` if you do not have it
(it is deliberately untracked). Run it in both Chrome and Safari before
shipping — Safari is the WebKit baseline that a future desktop build would use,
so a Chrome-only pass proves nothing about that target.

### Contributing

See [AGENTS.md](AGENTS.md) for commit message conventions and the working
agreements this repo expects.

## License

Not yet chosen.
