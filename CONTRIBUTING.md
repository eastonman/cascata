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
bun run check && bun run typecheck && bun run test && bun run build && bun run e2e
```

CI runs exactly these five, resolved through the flake so they cannot drift
from your dev shell. They arrive as three parallel jobs rather than one
sequence: **CI** (lint, types, unit tests, build) and **Browser tests** split
again per engine, so a WebKit-only failure is named in the job title instead of
buried in a combined log.

The browser jobs do not wait on the fast one. A lint error and a WebKit
regression are independent problems, and finding out about both in the same
minute beats finding out about them one after the other.

`bun run test` is the unit suite over the pure layers. `bun run e2e` drives the
built app in three projects — Chromium, WebKit, and an emulated iPhone: it
imports generated fixtures, checks that the waterfall paints and that equal
octaves take equal vertical space, that vibrato is not smoothed away, that the
playhead advances and the exported WAV parses, exercises compare mode, linking
and touch panning, and — in Chromium, which can fake a capture device — records
from a synthetic microphone and handles it being refused or unplugged.

**Prefer an assertion to a checklist line.** Anything a machine can watch,
a machine should: the manual checklist was 93 items, nobody ran it end to end,
and the parts that mattered were indistinguishable from the parts that did not.
Most of it turned out to be reachable from a pixel read — see `e2e/axes.spec.ts`
for the pattern of subtracting a silent column from a sounding one so overlays
cancel instead of being mistaken for signal.

WebKit runs on macOS in CI, and not only because the Linux build fights the
runner: Linux WebKit is the GTK port, a different engine build from the one
Safari ships, while Playwright's macOS WebKit is built on Apple's.

WebKit is not optional, and it is why the browser suite exists. It is the
baseline a future desktop build would use, and every Safari-only bug found so
far was found by hand, late: a blocked `localStorage` that took the whole app
down at boot, an `AudioContext` stuck in WebKit's non-standard `"interrupted"`
state, and the `data:` URL an AudioWorklet will not load from.

**Some things still have no automated cover**, and for those
[docs/manual-verification.md](docs/manual-verification.md) remains the only
guard. It is grouped by *why* each item is irreducible — a voice, ears,
browser or OS state, real time, or judgement — so that adding to it is
uncomfortable unless the item genuinely belongs. Run the sections your change
touches and say in the PR which ones you ran.

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
