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
| Load an audio file | **Import**, in the pane's header |
| Throw away a pane's audio | **Clear**, in the pane's header |
| Compare two recordings | **Compare** |
| Save the audio | **Export WAV** |

### Importing a file

**Import** decodes an audio file and analyses it exactly as if you had sung it:
the waterfall, scrubbing, playback, crosshair, and export all work on it
unchanged. It **replaces** whatever is currently in the buffer, so export first
if you want to keep a recording.

Whatever formats your browser can decode will work — WAV, MP3, and M4A
everywhere; FLAC and OGG vary. Stereo files are averaged to mono, matching how
the microphone is captured. The file is resampled to your device's rate, so the
frequency axis reads the same as it does for a recording.

The buffer grows to fit the file rather than staying at the 8-minute recording
limit, up to about 1 GB of analysis data — roughly 144 minutes at 48 kHz. Longer
files are truncated from the start and the status bar says so.

Two things to expect on a long file:

- **Analysis takes a while.** It runs in the background at about 30× real time,
  so a 30-minute file needs around a minute before the whole waterfall is
  filled. Progress shows in the status bar, and the part already analysed is
  usable immediately.
- **Memory is proportional to length.** A 3-minute file costs ~22 MB, a
  30-minute one ~225 MB. Above ~300 MB the status bar warns you. On a phone a
  file that large may get the tab killed by the operating system — that is
  outside what the page can catch or prevent.

**Clear** discards the recording and returns to the empty state. It is
unavailable while recording, so stopping first is the deliberate step; there is
no extra confirmation.

### Comparing two recordings

**Compare** splits the view into two panes, A and B. Each holds its own audio —
imported or recorded — and they share every display setting, so what you see in
one is directly comparable to the other.

Each pane's header carries its own **Import**, **Clear**, a duration, and a dot
that arms it for recording. Only one pane records at a time: there is one
microphone, and the armed dot decides where it goes. So the usual setup is a
reference take in A and your own singing recorded live into B.

**Link** locks the two panes together so they scroll and zoom as one. The
alignment it holds is whatever you had when you pressed it, which makes lining
two takes up a matter of unlinking, dragging each pane until the onsets match,
and linking again. Two performances are never the same tempo, so expect to
re-align rather than to stay in step for minutes.

<kbd>Tab</kbd> switches which pane the keyboard and **Play** act on. If audio is
playing it keeps playing, from the matching moment in the other pane — that
instant A/B is the fastest way to hear a difference you can already see.

Hovering one pane draws a faint line at the same moment in the other, so you do
not have to convert times by eye.

**Split** chooses stacked or side by side. Stacked puts the same frequency at
the same height in both panes, which is the better default for "are these the
same pitch". Side by side gives each pane full height at the cost of showing
half as much time. On a narrow screen the layout falls back to stacked either
way.

Leaving compare mode keeps both panes' audio — only **Clear** discards it.

### Settings

All of these are saved across reloads, and none of them touch the recorded
audio — changing one never costs you what you have already sung.

- **Window** — FFT length, 2048 / 4096 / 8192. Longer resolves pitch better and
  time worse. Only affects columns drawn after the change.
- **Max freq** — display ceiling, 2 / 5 / 8 / 12 kHz. Crops the view; the data
  above it is still stored.
- **Colors** — magma, viridis, turbo, or gray. The first two are perceptually
  uniform, so a step in dB reads as the same step in brightness anywhere in the
  range. **turbo** is Google's rainbow, blue through green to red: much more
  contrast, because a partial separates from the noise floor by hue as well as
  brightness. The cost is that it is dark at *both* ends — the quietest and
  loudest bins have nearly the same brightness and differ only in hue, which
  also makes them ambiguous in greyscale and to achromatopsia. Use it to find
  things; switch to magma to judge how loud they are.
- **Zoom** — 0.5× to 4× horizontal.
- **Floor** / **Range** — the dB window mapped onto the colormap. Lower the
  floor to see quiet detail, raise it to cut room noise.
- **A4** — 440 / 442 / 443 Hz. Moves the note gridlines and the cents readout.
- **Pitch** — show or hide the YIN curve.
- **Split** — stacked or side by side, for compare mode.

### Things worth knowing

- **The last 8 minutes are kept** while recording, then the oldest audio is
  overwritten. Export before you lose something you want. (Imported files are
  not subject to this — see above.)
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
bun run browser:install     # Playwright's browsers, once, for `bun run e2e`
bun run dev                 # http://localhost:5173
```

With [direnv](https://direnv.net/), `direnv allow` loads the shell
automatically — `.envrc` is already in the repo.

```sh
bun run test                # unit tests over the pure layers
bun run e2e                 # browser tests in Chromium and WebKit
bun run e2e:ui              # the same, with Playwright's inspector
bun run typecheck           # tsc --noEmit
bun run check               # biome format + lint check
bun run format              # biome format --write
bun run build               # typecheck, build to dist/, check the size budget
```

Browser versions are pinned by the exact `@playwright/test` in `package.json`,
so CI downloads the same builds you do. They do not come from the flake:
nixpkgs' WebKit is broken on Linux, and one supplier everywhere beats a
promise that holds on half the platforms.

### Layout

```
src/
  config.ts     analysis and storage constants
  dsp/          FFT, windowing, log binning, YIN, note names — pure functions
  store/        PCM ring buffer, spectrum column store — pure data structures
  analysis/     Analyzer: derives columns and f0 from PCM
  audio/        AudioSource interface, Web Audio capture, file decode, playback
  render/       colormap, waterfall renderer, overlays
  platform/     settings and file-save adapters
  export/       WAV encoder
  ui/           pane, view state, pane linking, controls, app shell and draw loop
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

Two suites, because the code splits cleanly into what can be reasoned about and
what has to be watched.

`bun run test` covers the pure layers: DSP numerics, the stores, the analyzer's
time grid, the WAV header, settings validation, the view-state interaction
rules, pane linking, and the pane model. 178 tests, no DOM.

`bun run e2e` drives the built app in Chromium and WebKit through Playwright.
It imports a generated fixture and checks that the waterfall paints, that an
octave step lands higher on the log frequency axis, that a corrupt file leaves
the previous audio intact, that compare mode and linking behave, and — in
Chromium, using a fake capture device — that recording from a microphone
actually works. 37 tests.

What neither covers, and what
[docs/manual-verification.md](docs/manual-verification.md) is still for:
anything needing a real microphone under WebKit, audio you can hear rather than
measure, phone layout and touch, the screen wake lock, and the eight-minute
ring wraparound. Run it in both browsers before shipping.

### Contributing

See [AGENTS.md](AGENTS.md) for commit message conventions and the working
agreements this repo expects.

## License

[GNU AGPL v3](LICENSE). If you run a modified version of Cascata as a network
service, that licence requires you to offer its source to users of that
service.
