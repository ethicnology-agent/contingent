# ADR-0005: Desktop notifications via OSC 777, not a host-side daemon

- Status: Accepted
- Date: 2026-07-26
- Owners: ethicnology
- Applies to: `bin/yknotify-agent`, `opencode/plugins/yknotify.ts`

## Problem

Both the SSH-agent proxy (ADR-0004) and the OpenCode notification plugin need
to reach the user's desktop from inside a remote session or a background
process, without requiring the user to install and run anything extra on
their own machine.

## Decision

Use the terminal escape sequence OSC 777 (`ESC ] 777 ; notify ; <title> ;
<body> BEL`), which [Warp supports natively and enables by
default](https://docs.warp.dev/terminal/more-features/notifications/). The
sequence travels over the already-open SSH connection as ordinary terminal
output; Warp on the host renders it as a desktop notification. No
`RemoteForward`, no host-side listener process, no additional port.

For callers without a directly attached TTY (a detached OpenCode plugin
process, for instance), the sequence is written to a TTY path captured
explicitly at shell login (`YKNOTIFY_TTY`) rather than guessed.

## Alternatives considered

### A custom TCP listener on the host + `RemoteForward`

Prototyped and works, but requires a host-side daemon process and an SSH
config change, for no benefit over OSC 777 when the terminal already supports
it. Kept in mind as a fallback for terminals without OSC support, not
implemented as the default here.

### Selecting the "most recently active" `/dev/pts/N` as a fallback

Rejected after measurement: a PTY's `mtime` does **not** update on write, so
"most recent" degenerated to "highest device number", which could point a
notification (and its commit-message content) at the wrong terminal tab.
Replaced with the explicit `YKNOTIFY_TTY` capture instead.

## Consequences

Positive: zero host-side installation. Works identically whether the host is
macOS or Linux, since Warp — not this repo — implements the receiving end.

Negative:

- Requires Warp (or another OSC-777-compatible terminal) on the receiving
  end. No fallback notification path currently ships in this repo for
  terminals without it.
- `YKNOTIFY_TTY`, being captured once at login, is absent for shells started
  before it was introduced, and doesn't follow a user across multiple
  concurrently open tabs beyond the one it was captured in.
- **The channel only stays useful while it stays quiet, and permission
  prompts made it useless.** The plugin originally notified on
  `permission.asked` as well. Measured on a real log: 3882 permission requests
  against 0 `question` tool calls. The trigger was marked `urgent`, so it also
  bypassed the 5 s refractory window, and under a global `bash: ask` it fired
  on nearly every command. It was removed rather than tuned — an authorization
  prompt is already visible in the terminal, so the notification added nothing
  while burying the one signal that cannot be seen any other way, the YubiKey
  touch. Two triggers remain: end of a turn longer than `YKNOTIFY_SEUIL_MS`,
  and the `question` tool.

  A mitigation shipped before that removal (reporting the pattern only when a
  request carried exactly one, since upstream's guard is per tool call and the
  payload holds no per-pattern action) is therefore gone too. It is kept in
  Evidence below because it documents upstream behaviour that still holds.

## Evidence

- Official Warp documentation for the OSC 9/777 format was read directly
  (not assumed), including the "different app must be focused" caveat that
  applies to Warp's *built-in* triggers — this caveat's applicability to OSC
  specifically was tested, not just read.
- A direct `printf` of an OSC 777 sequence, sent both while Warp was focused
  and while a different window had focus, was confirmed by the user to
  produce a visible notification in both cases.
- A detached, `setsid`-orphaned Python process — deliberately reparented to
  break any process-ancestry TTY lookup — successfully notified the correct
  terminal tab by using an explicitly passed client PID plus the
  `YKNOTIFY_TTY` fallback.
- The real OpenCode plugin's `question` and `permission.asked` hooks each
  produced a visible desktop notification in a live session, confirmed by
  the user. (`permission.asked` was later removed as a trigger; the
  measurement stands as evidence that the transport works.)
- **After the removal**, the two remaining triggers were exercised through the
  transpiled plugin with a stubbed `$`: `permission.asked` produces no
  notification at all, the `question` tool still produces
  `une question t'attend`, and `session.idle` still produces `terminé · N s`
  when the turn exceeds the threshold — while a short turn under the default
  30 s threshold correctly stays silent.
- **`permission.asked` is not published for an already-allowed action.** Read
  in the compiled OpenCode 1.18.7 `Permission.ask`: each pattern is passed to
  `evaluate(permission, pattern, ruleset, approved)`, which `findLast`-matches
  the flattened rules plus the session's `approved` list; `deny` returns an
  error, `allow` continues, and the function returns *before* `publish` unless
  some pattern remained `ask`. Blanket session approvals land in `approved`,
  so they are honoured.
- **The body used to name an allowed command.** In a live session log,
  request `per_fa3ba7c8c001b` carried nine bash patterns; the `evaluated`
  lines show `patterns[0]` (`rtk ls -t …`) resolving to `allow` via a `rtk *`
  approval, while the actual blockers (`echo …`, `ls -t …`, `tail -12`)
  appeared later in the array. The plugin displayed `patterns[0]`, so the
  notification named a command the user had already approved. Fixed by only
  showing a single-pattern detail.

## Revisit when

- Warp changes or removes OSC 777 support.
- A cross-terminal notification protocol becomes standard, removing the
  Warp-specific dependency.
