# Manual verification checklist

Rendering and interaction are not automatically tested (DESIGN.md §9). This
checklist is the substitute. Run it in **both Chrome and Safari** on macOS —
Safari is the WebKit baseline that the future macOS Tauri build will use, so a
Chrome-only pass proves nothing about that target.

```
nix develop --command bun run dev
```

Note the sample rate your device reports (the status bar buffers in seconds;
the analysis grid is 1024 samples per column, so at 48 kHz that is 46.9
columns/s). A device running at 44.1 kHz is a valid configuration and should
behave identically.

## Capture

- [ ] `Record` prompts for microphone permission, then the waterfall starts scrolling.
- [ ] `Stop` halts scrolling. **Data is not cleared** — the trace stays on screen and remains scrubbable.
- [ ] `Record` again resumes into the same buffer; the time axis continues rather than restarting.
- [ ] Denying microphone permission shows an error in the status bar and does not leave the button stuck in the recording state.

## AGC is actually off

This is the single most important check: browsers enable automatic gain control
by default, and it silently rewrites the intensity that this whole tool exists
to display.

- [ ] Sustain a steady vowel at constant loudness for ~20 s. The band brightness must stay constant.
- [ ] A slow brightening or dimming under a steady input means a gain processor is still active — investigate before trusting any intensity reading.
- [ ] Sing loudly, then softly. The brightness step must be immediate and must not "recover" over the following seconds.

## Failure paths

These are the paths that broke under review; they are easy to skip because
nothing prompts you to try them.

- [ ] Click `Record` twice in quick succession during the permission prompt. Capture must start once. If the waterfall scrolls at double speed, the re-entrancy guard has regressed.
- [ ] Deny microphone permission. The status bar explains, and the button returns to `Record`.
- [ ] Block cookies/site data in Safari and reload. The app must still boot on default settings.
- [ ] Unplug the microphone (or let another app take it) mid-recording. The status bar must say capture stopped rather than sitting on "Recording" over a frozen waterfall.
- [ ] After stopping, check the browser's recording indicator is off.
- [ ] Press `Play` and `Export WAV` immediately after `Record`, before any audio. Both must say something rather than silently doing nothing.
- [ ] Click `Record`, then press `Space` without clicking the canvas first. It must toggle playback, not stop the recording.
- [ ] Hide the tab while recording for several minutes, then return. The waterfall must catch up promptly rather than freezing; the gap reads as empty columns, not as silence.
- [ ] Select a Bluetooth headset microphone (which forces a 16 kHz context). The area above 8 kHz must read empty, not as a solid coloured stripe.
- [ ] If the device refuses to disable AGC/NS/EC, a warning appears in the status bar — do not trust intensity readings in that case.

## Import

- [ ] Import a WAV, an MP3, and an M4A. Each produces a waterfall that matches what the file sounds like.
- [ ] Import a stereo file. It must be downmixed, not read as one channel — check against the same file exported to mono.
- [ ] Import replaces whatever was in the buffer, and the time axis restarts from the file's start.
- [ ] After import the view is pinned at the beginning of the file, not at its end.
- [ ] Playback, scrubbing, the crosshair readout, and `Export WAV` all work on imported audio.
- [ ] Import a file longer than the cap (~144 min at 48 kHz). The status bar reports the truncation and the audio shown is the **start** of the file.
- [ ] Import a non-audio file (rename a `.txt` to `.wav`). The error appears and the previous recording is still there.
- [ ] Import a file of 20+ minutes. The UI stays responsive, `Analysing… N%` advances, and the already-analysed part is usable while the rest fills in.
- [ ] Import while a recording exists, then press `Record`. The buffer must go back to the 8-minute recording size rather than staying at the import size.
- [ ] Import before ever recording (fresh page load, never granted microphone access). It must work — no microphone permission is needed.

## Clear

- [ ] `Clear` is greyed out while recording and on a fresh page with no data.
- [ ] After stopping, `Clear` empties the waterfall, hides the playhead and cursor, disables `Play` and `Export`, and brings the hint text back.
- [ ] After clearing, `Record` starts a fresh recording with the time axis from zero.

## Compare mode

- [ ] `Compare` splits the view into panes A and B; pressing it again returns to a single pane.
- [ ] **Leaving compare mode keeps pane B's audio.** Re-entering shows it still there. This is the one that must not regress — only `Clear` may discard audio.
- [ ] Import different files into A and B; both waterfalls render and both headers show durations.
- [ ] Arm B (its dot), press `Record`. Audio goes to B and A is untouched.
- [ ] While recording into B, `Import` and `Clear` on B are unavailable but A's still work.
- [ ] `Clear` on one pane leaves the other alone.
- [ ] `Split` switches stacked / side by side. Both panes resize, nothing is recomputed, and the choice survives a reload.
- [ ] Hovering one pane draws a faint line at the same moment in the other.

## Link

- [ ] With `Link` off, each pane pans and zooms alone.
- [ ] Align two takes by dragging with `Link` off, then press `Link`: **nothing moves**. If either pane jumps, the offset is not being taken from the current positions.
- [ ] With `Link` on, panning or zooming either pane moves both, holding the alignment.
- [ ] Link two panes of very different lengths and pan to the end of the shorter one. Both stop together rather than drifting apart.
- [ ] Link with offset zero, arm B, play a reference in A while recording into B: A tracks the live edge.

## Active pane and A/B

- [ ] `Tab` moves the active marker between panes; `Play`, `Export WAV`, and the arrow keys follow it.
- [ ] `Tab` during playback continues from the matching moment in the other pane rather than stopping or restarting.
- [ ] With `Link` on, the A/B switch lands at the aligned moment; with it off, at the same absolute time.
- [ ] `Export WAV` exports the active pane, and the filename names it.

## Status bar

- [ ] Messages that matter stay long enough to read: deny microphone permission, or press `Play` with nothing recorded, and confirm the message is not overwritten within a frame.

## Waterfall and axes

- [ ] Frequency axis is logarithmic: an octave occupies the same vertical distance everywhere (compare C2→C3 with C6→C7).
- [ ] C1–C9 gridlines are labelled and land on the right pitches against a tuner or reference tone.
- [ ] The A4 reference line sits on a 440 Hz tone; switching A4 to 442 and 443 moves it up slightly each time.
- [ ] Scrolling speed is visually constant. It must not change when the window length changes.

## Parameters

Each of these must apply without a visible stall and without disturbing already-recorded audio.

- [ ] **Window** 2048 / 4096 / 8192: only newly drawn columns change resolution. Older columns keep their original appearance, and nothing shifts horizontally in time.
- [ ] **Max freq** 2 / 5 / 8 / 12 kHz: crops the view instantly. Switching back reveals the same data — no recompute, no gap.
- [ ] **Colors** magma / viridis / gray: recolours the full visible history, not just new columns.
- [ ] **Zoom** 0.5 / 1 / 2 / 4×: changes the visible time span. While following, the right edge stays put; while pinned, the left edge stays put.
- [ ] At 2× and 4× zoom, drag the canvas *slowly* with a trackpad or finger. The view must track the gesture continuously — sticking, then jumping when you speed up, means sub-column pan deltas are being discarded.
- [ ] **Floor** and **Range** sliders change contrast live across the whole visible history.
- [ ] **Pitch** checkbox shows/hides the YIN curve. Columns recorded while it was off stay blank when it is turned back on — they were never analysed.
- [ ] All settings survive a page reload.

## Mouse wheel

- [ ] Scrolling the wheel over the canvas pans the waterfall through time, and pins the view.
- [ ] On a trackpad, a two-finger horizontal swipe pans as well as a vertical one.
- [ ] The page itself never scrolls, and the canvas does not drift out from under the pointer.
- [ ] With `Link` on, scrolling one pane moves both.
- [ ] Ctrl/Cmd + wheel still zooms the browser, rather than being swallowed.

## Pitch curve

- [ ] A steady sung note produces a steady line at the right pitch.
- [ ] Vibrato appears as a visible oscillation — it must not be smoothed flat.
- [ ] The line breaks during silence rather than connecting across the gap.
- [ ] Octave errors, if they occur, appear as visible jumps. This is intended: they are not hidden.

## Review, playback, export

- [ ] Dragging the canvas pins the view and pans through history. **Recording continues** while pinned — the buffered time in the status bar keeps growing.
- [ ] `Follow` returns to the live edge and re-enables scrolling.
- [ ] Clicking sets a dashed play cursor.
- [ ] `Play` starts from the cursor; a solid playhead tracks the audio, and the view follows it past the right edge.
- [ ] `Space` toggles playback; `Esc` stops it; `←`/`→` pan, and `Shift` makes them pan faster.
- [ ] What you hear lines up with what the playhead is over.
- [ ] `Export WAV` downloads a file that opens in an audio editor, is mono 16-bit at the device sample rate, and whose duration matches the buffered time shown in the status bar.

## Crosshair readout

- [ ] Hovering shows time, frequency, note ± cents, and level.
- [ ] The frequency under the crosshair matches the note label (cross-check a 440 Hz tone: `A4 +0¢`).
- [ ] Changing A4 changes the cents reading for the same tone.
- [ ] Near the canvas edges the readout box flips to stay fully visible.

## Ring buffer wraparound

This takes 8 minutes and is the check most likely to be skipped — do it anyway,
because an index bug here corrupts the entire time axis and only shows up here.

- [ ] Record continuously for more than 8 minutes.
- [ ] Time axis labels keep increasing; they must not reset or jump backwards.
- [ ] Panning back stops at the oldest retained audio rather than showing garbage or crashing.
- [ ] Export after wraparound produces exactly the retained window (~8 min), not the whole session.
- [ ] Memory in the browser's task manager stays roughly flat after the buffer fills (target < 100 MB).

## Latency

- [ ] Clap or tap the microphone. The vertical streak must appear essentially immediately (< 100 ms budget; anything perceptible as lag warrants measurement).

## Phone

Serve over the LAN (`bun run dev` already binds all interfaces) and open the
printed network URL. Note that `getUserMedia` requires a secure context —
`localhost` counts, a plain-HTTP LAN address does not. Use a tunnel or a local
HTTPS cert.

- [ ] Portrait layout: controls wrap without overflowing; the canvas keeps the remaining height.
- [ ] Every control is comfortably tappable.
- [ ] Touch drag pans; tap sets the cursor. The page itself must not scroll or rubber-band while dragging the canvas.
- [ ] Pinch does not zoom the page.
- [ ] The screen does not dim or lock during recording (Screen Wake Lock).
- [ ] Backgrounding and returning during recording does not break capture, and the wake lock is re-acquired.
- [ ] Safe-area insets are respected on a notched device.

## Cross-browser sign-off

| Check group | Chrome | Safari |
|---|---|---|
| Capture | | |
| AGC off | | |
| Waterfall and axes | | |
| Parameters | | |
| Pitch curve | | |
| Review, playback, export | | |
| Crosshair readout | | |
| Ring buffer wraparound | | |
| Latency | | |
| Phone | | |
