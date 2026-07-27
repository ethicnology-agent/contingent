# ADR-0004: Intercept forwarded SSH-agent requests for security-key notifications

- Status: Accepted
- Date: 2026-07-26
- Owners: ethicnology
- Applies to: `bin/yknotify-agent`, Linux hosts using a forwarded SSH agent
  backing a FIDO2/U2F security key (`sk-*` key types)

## Problem

A forwarded security key can request physical presence (a touch) without
telling the user *which* remote process caused the request. Touching the key
blindly, over and over, is not meaningful consent — it's a reflex. On a
machine juggling several forwarded SSH sessions and agents, there was no way
to tell a routine `git commit` from something unexpected asking for a
signature.

## Decision

Place a transparent SSH-agent protocol proxy inside the remote machine. It
sits between local clients (`git`, `ssh`, `ssh-keygen`, ...) and the real
forwarded agent (`$SSH_AUTH_SOCK`). For every `SIGN_REQUEST` whose key type
starts with `sk-`, it:

1. **Forwards the request to the real agent first, unconditionally, before
   doing anything else.** Context extraction happens on a separate thread
   after the request is already in flight.
2. Identifies the calling process via `SO_PEERCRED`, walks `/proc/<pid>` to
   derive a project name, an action (`commit`, `push → origin`, `ssh → host`,
   ...), and a message (commit message, branch).
3. Pushes an OSC 777 desktop notification
   (`YubiKey — <project>` / `<action> · <message>`) to the originating
   terminal, via a TTY captured explicitly by the shell at login
   (`YKNOTIFY_TTY`), falling back to walking the process's own ancestry for a
   controlling TTY.

The shell (`.bashrc`-equivalent) transparently swaps `SSH_AUTH_SOCK` to point
at this proxy, only if the proxy actually responds; otherwise the original
agent socket is left untouched.

## Alternatives considered

### Wrapper functions around `git`/`ssh`

Rejected: IDEs, editor plugins, hooks, and any subprocess that doesn't go
through the user's interactive shell bypass a wrapper entirely.

### Forward the desktop D-Bus session bus to the remote host

Rejected. Measured directly: both a raw `dbus-daemon` and `xdg-dbus-proxy`
reject an `AUTH EXTERNAL` identity that doesn't match the actual peer UID of
the forwarded socket — and the local and remote UIDs commonly differ (e.g.
`501` inside a Lima VM vs `1000` on the host). Making it work would require a
byte-rewriting shim on the AUTH handshake, which was prototyped and shown to
work, but it also risks exposing far more of the session bus
(`systemd --user`, secret services) than intended. Rejected as
disproportionate for "tell me why the key is blinking."

### Custom TCP notification listener + a host-side daemon

A working fallback for terminals without OSC support, but rejected as the
*default* mechanism: it needs a `RemoteForward` and a host-side listener
process, whereas OSC 777 (see ADR-0005) needs neither.

## Security invariants

- **The sign request must reach the upstream agent before context extraction
  starts**, on a separate path, with no shared blocking dependency. A `.git`
  directory replaced by a FIFO (adversarial test) must not delay the
  signature.
- Runtime directory (`$XDG_RUNTIME_DIR/yknotify`) must be owned by the
  current UID and mode `0700`; sockets `0600`; lock/memo files opened with
  `O_NOFOLLOW`, verified by `fstat` to be a regular file owned by the current
  effective UID before use.
- A connecting client's `SO_PEERCRED` UID must equal the proxy's effective
  UID; mismatches are treated as unidentified (no context, but the request is
  still forwarded).
- Every socket operation (probe, client read, upstream connect) has a bounded
  deadline except the final wait for the upstream's actual sign response,
  which may legitimately take as long as the user needs to touch the key.
- Concurrent daemon starts are serialized with an `flock` across the entire
  probe → cleanup → bind sequence; readiness is signaled to the parent
  process through a pipe only after `bind` + `chmod` + `listen` + writing the
  upstream memo file have all succeeded — not merely once the socket path
  exists.
- A daemon whose upstream forwarded agent has disappeared removes its own
  socket only if no client connection is active and only if the socket still
  has the inode it originally bound (guards against a newer daemon having
  already replaced it).
- Context-derivation failures (unreadable `.git`, unknown command shape) must
  never suppress or delay forwarding the request; at worst, the notification
  is generic or absent.
- **No notification sits on the path of a frame, in either direction.** The
  request direction was always threaded; the response direction was not — the
  `SSH_AGENT_FAILURE` notification ran synchronously before the failure was
  handed back to the client, walking up to twelve `/proc` entries and opening a
  pts first. Both directions now write the frame, then notify on a daemon
  thread. Stated as an invariant because the asymmetry was not deliberate: the
  original wording covered only the request.

## Consequences

Positive: the user sees project, action, and message before the key is
touched — the touch becomes informed consent instead of a reflex. No extra
host-side service or SSH forwarding directive is required beyond the agent
forwarding already in use.

Negative / known limits:

- The proxy is on the SSH-agent availability path. A bug in it can degrade
  (not silently corrupt) SSH authentication; the shell wiring is designed to
  fail back to the original, unproxied agent socket rather than break it.
- Context derivation is best-effort string parsing of `/proc/<pid>/cmdline`
  and `.git` metadata — it can misattribute the project or action for unusual
  invocations (e.g. `git push -o <opt>`, `git commit -- -m ...`, `scp -P
  <port>` were all found to be misparsed in early versions and fixed; more
  edge cases likely remain).
- `sk-*` indicates a *security-key* signature request — it does not by itself
  prove the key's policy actually requires touch, nor that `SSH_AGENT_FAILURE`
  specifically means "user declined" rather than "key absent" or "agent
  locked".
- **An un-touched request is indistinguishable from a misconfiguration at the
  client.** It surfaces as `sign_and_send_pubkey: signing failed for
  ED25519-SK … agent refused operation` followed by
  `Permission denied (publickey)` — wording that invites debugging keys,
  remotes and access rights when the only thing missing is a touch. The
  notification this proxy exists to send is precisely what disambiguates it,
  but only if the user is looking at the window. `opencode/AGENTS.md` therefore
  instructs agents to report a pending touch instead of investigating, so a
  missed notification costs one retry rather than a diagnostic detour.
- The fallback TTY heuristic (`YKNOTIFY_TTY`, set once at shell login) can be
  stale or absent for a shell spawned before this variable was introduced; in
  that case a detached caller with no discoverable TTY simply doesn't notify.

## Evidence

Verified directly, in this environment:

- Correct wire-format parsing of `uint32`-length-prefixed frames,
  `SIGN_REQUEST`, and key-blob type extraction, against a real forwarded
  agent (`ssh-add -l` through the proxy showed the real keys).
- A software (non-touch) key added, used to sign, and verified
  cryptographically through the full proxy path end-to-end.
- **Adversarial test**: `.git` replaced with a FIFO in a throwaway repo — the
  upstream agent received the forwarded `SIGN_REQUEST` in 0.2 ms, independent
  of the subsequently-blocked context thread.
- **The response direction was measured, and had been blocking.** With
  `notifier` stubbed to take 500 ms and a fake upstream agent returning
  `SSH_AGENT_FAILURE`, the client received its response in 500.5 ms before the
  fix and 0.4 ms after, the notification still firing in both cases. The
  request-direction test above had never covered the return path.
- 8 concurrent `start` invocations against a cold cache produced exactly one
  daemon and one socket.
- Runtime files observed at `0700`/`0600` in practice; a `chdir("/")`,
  `umask(0o077)`, and closing of inherited file descriptors were confirmed on
  the running daemon (`/proc/<pid>/fd` inspected — no stray descriptors, no
  retained working directory in `$HOME`).
- A real `question` tool call and a real `permission.asked` bash-approval
  event each produced the expected desktop notification (see ADR-0005),
  confirmed by the user, not simulated.
- Recovery from a dead proxy socket: killing the daemon and re-running
  `yknotify-agent start` with the stale socket path re-created a working
  proxy at the same path, confirmed via `ssh-add -l`.
- **A real physical touch on the hardware key, end-to-end through the proxy.**
  Observed on 2026-07-27, unplanned, during an ordinary `git push`: three
  `sk-*` sign requests (one `git fetch`, one `ssh -T`, one `git push`) failed
  with `agent refused operation` while no touch was given, then the same
  `git push` succeeded unchanged once the user touched the key. No
  configuration was altered between the failures and the success, which is
  what makes the touch the only variable. The notifications had been delivered
  throughout; the user had simply not looked at the window — so this also
  confirms the notification path fires for genuine hardware sign requests, and
  not only for the software-key and fake-agent cases listed above.

This last item was recorded as **not verified** until 2026-07-27: every other
test above used either a software key or a deliberately failing fake upstream
agent, to avoid requiring physical interaction during automated testing.

## Revisit when

- OpenSSH adds contextual agent confirmations natively (making this proxy
  unnecessary).
- The terminal in use drops OSC 777 support (see ADR-0005) — the transport
  would need to change, not the interception logic.
- Moving off Linux: the implementation depends on `/proc`, `/dev/pts`,
  `SO_PEERCRED`, and POSIX `fork`/`setsid`, none of which are portable as-is.
