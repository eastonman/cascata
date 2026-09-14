# Contributing

## Getting set up

[README.md](README.md#developing) has the commands. Short version: install Nix
with flakes, then `nix develop` and `bun install`.

## Conventions

They live in [AGENTS.md](AGENTS.md) — commit message format, the signing
workflow, code style, the architectural invariants, and the testing standard.
That file is written for both humans and coding agents, and it is the single
copy on purpose: conventions duplicated across two documents drift apart, and
then nobody knows which one is current.

Read the **Architectural invariants** section before changing anything under
`src/`. Breaking one of those four rules produces bugs that are quiet and show
up minutes or hours into a session.

## Before you open a pull request

```sh
bun run check && bun run typecheck && bun test && bun run build
```

CI runs exactly these four, resolved through the flake so it cannot drift from
your dev shell. It takes about 40 seconds.

**If you touched capture, rendering, or interaction, that is not enough.**
Roughly 1,900 lines — `app.ts`, `pane.ts`, `controls.ts`, `waterfall.ts`,
`webAudioSource.ts`, `player.ts` — have no unit tests, because they need a real
canvas, a real microphone, and a real audio context. The substitute is
[docs/manual-verification.md](docs/manual-verification.md). Run the sections
your change touches, in **both Chrome and Safari**, and say in the PR which
ones you ran.

Safari is not optional. It is the WebKit baseline that a future desktop build
would use, and several of the bugs found so far were Safari-only: a blocked
`localStorage` that took the whole app down, an `AudioContext` stuck in
WebKit's non-standard `"interrupted"` state, and the `data:` URL an AudioWorklet
will not load from.

## What makes a change easy to accept

- **Explain why in the commit body.** The diff shows what changed. What it
  cannot show is the alternative you rejected or the failure you were
  preventing. Commits here run long for that reason.
- **Assert the invariant, not a side effect of it.** If you can imagine a
  plausible mutation of your code that your test would still pass, the test is
  too weak. A real example from this repo: a test claimed to check the STFT
  time grid but only compared two columns relatively, so left-aligning the
  analysis window — shifting the whole spectrogram 42.7 ms out of step with the
  audio — passed the entire suite.
- **Take tolerances from a stated physical limit** — one FFT bin, one log bin,
  one quantisation step — not from whatever number made the test go green.
- **No runtime dependencies.** `dependencies` in `package.json` stays empty.

## Reporting a bug

Include the browser and version, the device sample rate (the status bar shows
what is buffered; the analysis grid is 1024 samples per column), and whether
the audio came from the microphone or from an import. Sample-rate-dependent
bugs are a recurring theme — a 16 kHz Bluetooth headset mic has surfaced more
than one.

## Licence

Cascata is [AGPL-3.0](LICENSE). Contributions are accepted under the same
licence.
