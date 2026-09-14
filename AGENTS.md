# Working agreements

For humans and coding agents alike. [README.md](README.md) covers what the
project is and how to run it; this file covers how to change it.

## Commit messages

Linux kernel style.

```
<type>(<scope>): <subject in the imperative, lower case, no trailing period>

<body: wrapped at 72 columns, explaining why rather than what>

Assisted-By: <Name> <email>
```

- Subject line ≤ 72 characters, imperative mood — "add the ring buffer", not
  "added" or "adds".
- `<type>` is one of `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`.
  `<scope>` is the directory under `src/` the change lives in (`dsp`, `store`,
  `render`, `ui`, `audio`, `platform`, `analysis`, `export`), omitted when the
  change is repo-wide.
- The body explains **why**. The diff already shows what changed; what it
  cannot show is the reasoning, the alternative you rejected, or the failure
  mode you were preventing. If a bug is being fixed, say what it did wrong and
  under what conditions.
- Trailers go last, one per line, after a blank line.

### Trailers

| Trailer | Use |
|---|---|
| `Assisted-By:` | An AI tool materially contributed to the change. |
| `Reported-by:` | Someone reported the bug being fixed. |
| `Reviewed-by:` | Someone reviewed the change before it landed. |
| `Tested-by:` | Someone verified it on hardware or a browser you cannot reach. |

`Assisted-By:` is this repo's convention and replaces `Co-Authored-By:`. It is
the honest description: the tool assisted, the human is the author and remains
accountable for the result.

## Signing

Commits are signed. The signing subkey lives on a hardware token, so an agent
running in a non-interactive shell cannot produce a signature — `gpg` fails
with `Timeout` or `Bad PIN`.

The working pattern is: commit unsigned during development with
`git -c commit.gpgsign=false`, then sign the whole branch in one pass before
merging, once the token is unlocked:

```sh
git branch backup-presign-<name>
git rebase --exec 'git commit --amend --no-edit --no-verify -S' main
git log --format='%G? %h' main..HEAD    # every line must start with G
git diff backup-presign-<name> HEAD     # must be empty — signatures only
```

To check whether signing is currently available, probe **without touching git
state**:

```sh
echo probe | gpg --local-user <keyid> --clearsign --output /dev/null
```

Never test it with a throwaway commit chained to a cleanup command. A
`git commit ... && git reset --hard HEAD~1` whose commit half fails will still
run the reset, landing on a real commit and discarding uncommitted work.

## Code

- **English only** — comments, identifiers, and user-facing strings.
  Internationalisation is deferred; do not add Chinese to the codebase.
- **Match the surrounding style.** Biome enforces formatting (`bun run
  format`); it does not enforce taste.
- **Comments explain why, not what.** A comment restating the code is worse
  than none. A comment recording a constraint, a rejected alternative, or a
  browser quirk is worth several lines.
- **No runtime dependencies.** `dependencies` in `package.json` stays empty.
  Vite, TypeScript, and Biome are dev-only.
- **Stay inside the Safari baseline.** Forbidden: WebGPU, SharedArrayBuffer,
  the File System Access API, `OffscreenCanvas`. A future desktop build uses
  WebKit, so "works in Chrome" is not sufficient evidence.

### Architectural invariants

Breaking these is easy and the resulting bugs are quiet.

1. **Layering is one-way:** `ui → analysis / render / audio / platform → store / dsp`.
   `dsp/` and `store/` import nothing above themselves.
2. **Recorded PCM is the only source of truth.** Everything else is derived and
   disposable. Capture writes samples and nothing else.
3. **Indices are absolute and never reset.** Ring overwriting is expressed by
   `earliestIndex` advancing. Resetting a counter breaks the time axis in a way
   that only shows up eight minutes into a session.
4. **Platform-specific calls live behind `src/platform/`.** Nothing outside it
   touches `localStorage` or creates download anchors.

## Tests

- Write the failing test first, run it, watch it fail for the reason you
  expect, then implement.
- Test the pure layers: `dsp/`, `store/`, `analysis/`, `export/`, and the view
  state. Rendering and interaction are covered by a manual checklist instead.
- **Assert the invariant, not a side effect of it.** A test that passes when
  the whole time grid shifts uniformly is not testing the time grid. If you can
  imagine a plausible mutation that survives your test, the test is too weak.
- Tolerances should come from a stated physical limit — one FFT bin, one log
  bin, one quantisation step — not from whatever number made it pass.

## Before proposing a change as done

```sh
bun run check && bun run typecheck && bun run test && bun run build
```

All four must be clean. If you touched capture, rendering, or interaction, say
plainly that the manual checklist has not been run — none of the above
exercises a real microphone or a real canvas.

Report what actually happened. If a test fails, show the output. If you skipped
part of the scope, say which part and why.
