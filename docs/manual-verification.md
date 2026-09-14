# Manual verification checklist

Everything that can be checked by a machine is. 188 unit tests cover the DSP,
the geometry, and the view logic; 55 browser tests in `e2e/` drive the real app
in Chromium, WebKit, and an emulated phone. Run those first — they are fast and
they are the reason this file is short:

```
nix develop --command bun run test
nix develop --command bun run e2e
```

What remains here needs a human because it needs a voice, a pair of ears, real
hardware, real time, or a judgement call. **Do not re-check things the suite
already covers.** A checklist long enough to be ignored verifies nothing, and
this one was 93 items before it was cut down to what actually needs you.

Run it in **both Chrome and Safari** on macOS. Safari is the WebKit baseline the
future Tauri build will use.

```
nix develop --command bun run dev
```

## It needs your voice

Automated capture uses `--use-file-for-fake-audio-capture`, which is a file, not
a microphone. Nothing below can be reached that way.

- [ ] **AGC is off.** Sustain a steady vowel at constant loudness for ~20 s. Band brightness must stay constant. A slow brightening or dimming under steady input means a gain processor is still running — and intensity is the thing this tool exists to display, so nothing else on screen can be trusted until it is fixed.
- [ ] Sing loudly, then softly. The brightness step must be immediate and must not "recover" over the following seconds.
- [ ] **Latency.** Clap or tap the microphone. The streak must appear essentially immediately; the budget is 100 ms, and anything perceptible as lag warrants measuring.
- [ ] Select a Bluetooth headset microphone, which forces a 16 kHz context. Above 8 kHz must read empty, not as a solid coloured stripe.
- [ ] On a device that refuses to disable AGC/NS/EC, the status bar warns. (The warning path exists; only real hardware triggers it.)
- [ ] **Recording in Safari at all.** Press `Record`, grant permission, confirm the waterfall scrolls, stop, and confirm the audio is kept. Under Playwright's headless WebKit the app never gets past `await audioContext.resume()` — the context stays suspended and the promise never settles — so *every* capture test is Chromium-only. Safari's capture path has no automated cover whatsoever.

## It needs your ears

- [ ] What you hear during playback lines up with what the playhead is over. The suite can prove the playhead advances; only you can tell whether the audio agrees with it.
- [ ] `Link` with offset zero, arm B, play a reference in A while recording into B. The two takes must stay together to the ear, not merely on screen.
- [ ] Export a WAV and open it in an audio editor. It must sound like what was recorded. (Header, channel count, bit depth, and sample rate are asserted in `e2e/playback.spec.ts`; that it is the *right audio* is yours.)

## It needs the browser or the OS, not the page

- [ ] After stopping, the browser's own recording indicator goes off. A leaked track keeps it lit for the rest of the session.
- [ ] `Ctrl`/`Cmd` + wheel still zooms the browser rather than being swallowed by the canvas.
- [ ] Hide the tab while recording for several minutes, then return. The waterfall catches up promptly; the gap reads as empty columns, not as silence.
- [ ] On a phone: the screen does not dim or lock during recording, and the wake lock is re-acquired after backgrounding and returning.
- [ ] On a notched phone: safe-area insets are respected.

Serving to a phone needs a secure context — `getUserMedia` accepts `localhost`
but not a plain-HTTP LAN address. Use a tunnel or a local HTTPS certificate.

## It needs real time or real files

These are automatable in principle and deliberately are not: each would add
minutes to every CI run, or gigabytes to the repository.

- [ ] **Ring buffer wraparound.** Record continuously for more than 8 minutes. Time labels keep increasing and never jump backwards; panning back stops at the oldest retained audio rather than showing garbage; export yields the retained window, not the whole session; memory stays roughly flat once the buffer fills (target < 100 MB). The index arithmetic underneath has unit tests, but only the clock proves them in place.
- [ ] Import a file of 20+ minutes. The UI stays responsive, `Analysing… N%` advances, and the analysed part is usable while the rest fills in.
- [ ] Import a file longer than the ~144-minute cap. The status bar reports the truncation and what is shown is the **start** of the file.
- [ ] Import an MP3 and an M4A. Each matches what the file sounds like. (The fixtures are synthesised WAVs; these exercise the browser's own decoders.)

## It needs your judgement

- [ ] Scrolling speed looks constant, and does not change when the window length changes.
- [ ] At 2× and 4× zoom, drag the canvas *slowly* with a trackpad or finger. The view tracks the gesture continuously — sticking and then jumping when you speed up means sub-column pan deltas are being discarded.
- [ ] `C1`–`C9` gridlines land on the right pitches against a tuner or a reference tone.
- [ ] Is the display actually useful for singing? Legible at arm's length, fast enough to correct against, showing the thing you were trying to see. No assertion covers this, and it is the only question that finally matters.

## Sign-off

| | Chrome | Safari | Phone |
|---|---|---|---|
| Your voice | | | |
| Your ears | | | |
| Browser / OS | | | |
| Real time / files | | | |
| Judgement | | | |
