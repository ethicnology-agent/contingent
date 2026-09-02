# ADR-0014: Render bounded terminal image previews through Chafa

- Status: Accepted
- Date: 2026-08-13
- Owners: ethicnology
- Applies to: `opencode/tools/image-display.ts`, `opencode/tools/image-warp.ts`,
  `opencode/tools/image-warp-close.ts`, `opencode/lib/kitty-graphics.ts`,
  `opencode/opencode.jsonc`

## Problem

OpenCode can generate and inspect image files, but its TUI does not provide a
portable tool for showing a generated image to the user. A small community tool
writes Kitty graphics sequences directly to a discovered TTY, but it is
Kitty-only, unlicensed, lightly maintained, and rejects Warp explicitly.

## Decision

Expose local `image-display`, `image-warp`, and `image-warp-close` tools. The
tools:

- accepts only regular files canonically located in the active worktree or
  `~/debian/generated-images`;
- invokes `/usr/bin/chafa` without a shell, with bounded dimensions and a
  30-second timeout;
- inherits the terminal on stdout so Chafa can negotiate its best supported
  graphics protocol, while offering an explicit `symbols` ANSI/Unicode
  fallback;
- responds to OpenCode cancellation, requires confirmation for primary agents,
  and are denied to the read-only analyst and worker agents;
- never sends image bytes over the network and adds no npm runtime dependency.

`image-warp` writes bounded PNG Kitty graphics sequences to the discovered
terminal and keeps one placement above the TUI. `image-warp-close` deletes that
placement and sends `SIGWINCH` so the interface repaints. Warp supports the
Kitty graphics transport but not iTerm2 inline images. All four local image
tools (`imagegen`, `image-display`, `image-warp`, and `image-warp-close`) have
explicit global `ask` permissions in OpenCode.

Chafa is a machine dependency, installed separately from this configuration.

## Alternatives considered

### Install `rezrov/opencode-image`

Rejected. At evaluation time it had no declared license or releases, only six
commits and seven stars, and its Python implementation exits unless a Kitty
environment variable is present. It also reimplements terminal sizing and
graphics transport that Chafa already handles across multiple protocols.

### Open the image through a desktop command

Rejected as the primary path. `open`, `xdg-open`, and similar commands act on
the remote machine and do not compose reliably with SSH or headless sessions.

### Return ANSI image bytes as tool output

Rejected. OpenCode captures and truncates tool output before rendering it, and
graphics control sequences can be escaped or interpreted as transcript text.
The renderer must write to the inherited terminal while returning only a short
status string to the model.

## Consequences

Positive: the implementation is small, local, cross-terminal, and relies on a
widely packaged renderer rather than a bespoke terminal protocol adapter.

Negative / known limits:

- Chafa must be installed manually and available at `/usr/bin/chafa`.
- Graphics-protocol support still depends on the terminal and SSH path. The
  `symbols` mode is less faithful but remains portable.
- Writing to the inherited terminal means the preview is presentation outside
  OpenCode's transcript model; scrolling or repainting can remove it.

## Evidence

- Debian 13 installed Chafa 1.14.5 from the signed distribution package.
- `npm run typecheck` validates the tools against
  `@opencode-ai/plugin@1.18.26`.
- Chafa successfully decoded the generated Prompt PNG and rendered it in
  `symbols` mode under Warp over SSH/Lima.
- The static coherence check accepts the dedicated permission entries for all
  three preview tools.
- `tests/check-coherence.py` passes with the installed symlinked config.

## Revisit when

- OpenCode gains a first-party image preview attachment or terminal rendering
  API.
- Warp and OpenCode expose a stable image block protocol that avoids direct
  terminal output.
