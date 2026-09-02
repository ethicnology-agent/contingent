# contingent

*A portable contingent of well-behaved coding agents.*

Rules, skills, plugins and a small SSH-agent proxy that make [OpenCode](https://opencode.ai)
agents behave consistently across machines: sane Git history hygiene,
review-oriented commit slicing, per-role permissions, and a desktop
notification that tells you *why* your security key is asking for a touch
before you touch it.

This repo is the config, not a magic installer. Read
[docs/decisions](docs/decisions/) if you want the reasoning, not just the
files.

## What's in here

```text
opencode/       OpenCode config, global AGENTS.md, prompts, plugins, tools
git/            Portable Git behavior (autosquash, rerere, aliases...)
skills/         On-demand skills: delivery, rtk, Android and disk/build safety
bin/            yknotify-agent: SSH-agent proxy for security-key context
docs/decisions/ Why each mechanism exists, and what was actually verified
tests/          Static checks: does the config say what it does?
```

## What's deliberately NOT in here

- **Personal identity**: your Git name, email, and signing key stay in your
  own `~/.gitconfig`, included via `git/agentic.gitconfig` (see below).
  Never commit them here.
- **Machine topology**: hostnames, ports, users, SSH forwards and anything
  else describing one specific machine belong in `opencode/AGENTS.local.md`,
  which is gitignored and loaded through `instructions` in `opencode.jsonc`.
  `opencode/AGENTS.md` carries the portable constraint, never the values.
  See [docs/decisions/0012](docs/decisions/0012-machine-local-instructions.md).
- **Secrets**: no API tokens, no private keys, no `auth.json`. See
  [docs/decisions/0008](docs/decisions/0008-supply-chain-pinning.md) and the
  `.gitignore`.
- **An automated installer.** There is no `bootstrap` script yet. Building
  one that does atomic releases and rollback safely is real work that hasn't
  been done or tested. Claiming otherwise here would violate the repo's own
  [verification rule](opencode/AGENTS.md#vérification). Manual install below,
  contributions to automate it welcome.

## Manual install

Requires Git ≥ 2.44, Python ≥ 3.10, an OpenSSH client, and OpenCode 1.18.26.
[Chafa](https://hpjansson.org/chafa/) is required only for inline image
previews (`sudo apt install chafa` on Debian).
[rtk](https://github.com/rtk-ai/rtk) 0.47.0 is optional: the plugin prefers
`$HOME/.local/bin/rtk` and falls back to `PATH`; shell commands are rewritten to filter their output
([0010](docs/decisions/0010-rtk-command-rewriting.md)); without it, the plugin
disables itself.

```bash
git clone git@github.com:ethicnology/contingent.git
cd contingent

# OpenCode config — merges with (and overrides) any existing global config
ln -s "$PWD/opencode" ~/.config/opencode

# Git behavior, kept separate from your identity
mkdir -p ~/.config/git
ln -s "$PWD/git/agentic.gitconfig" ~/.config/git/agentic.gitconfig
git config --global --add include.path "$HOME/.config/git/agentic.gitconfig"

# On-demand skills
mkdir -p ~/.agents/skills
ln -s "$PWD/skills/decoupage-livraison" ~/.agents/skills/decoupage-livraison
ln -s "$PWD/skills/rtk" ~/.agents/skills/rtk
ln -s "$PWD/skills/appareil-android" ~/.agents/skills/appareil-android
ln -s "$PWD/skills/espace-disque-builds" ~/.agents/skills/espace-disque-builds

# SSH-agent proxy (optional, see docs/decisions/0004)
ln -s "$PWD/bin/yknotify-agent" ~/.local/bin/yknotify-agent
```

Then set your own identity, which must stay **out** of this repo:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global user.signingkey "~/.ssh/your-key.pub"   # if using SSH signing
```

Verify:

```bash
cd tests && python3 check-coherence.py
opencode debug config
```

Restart OpenCode after any config change — it isn't hot-reloaded.

The `ln -s` above matters more than it looks. If `~/.config/opencode` ends up
a **copy** of `opencode/` instead of a symlink, everything keeps working while
nothing you commit ever reaches the running agent: fixes land in Git and the
live config stays frozen at whatever the copy was. `check-coherence.py` fails
loudly on that case, and passes quietly when the path is absent or points at
another clone.

## Prem providers

The configuration defines two deliberately separate Prem paths:

- `prem/*` is the confidential path. The local Confidential Proxy encrypts
  requests before sending them to Prem. OpenCode reads the API key from
  `~/.secrets/prem-api-key`; start the proxy with the API key and client KEK
  read directly from their machine-local files rather than exported globally.
- `prem-router/kimi-k3` uses `router.prem.io` over ordinary TLS. It supports
  tools, attachments, and reasoning, but Prem can read the prompt. Kimi is the
  configured default by explicit operator choice; select GPT or Opus before the
  first turn when repository confidentiality matters.

Neither API key nor the KEK belongs in this repository. The current endpoint
URLs are published at `https://dashboard.prem.io/endpoints.json`. See
[ADR-0011](docs/decisions/0011-prem-provider-integration.md) for the trust
boundary and operational limits.

## Image generation

The optional `imagegen` tool delegates to an authenticated Codex CLI installed
at `~/debian/codex-cli` and writes new PNGs under
`~/debian/generated-images`. It is permission-gated, unavailable to read-only
or worker agents, and does not pass OpenCode's provider credentials into the
Codex subprocess. Prompts and reference images still leave the machine for
OpenAI; see [ADR-0013](docs/decisions/0013-image-generation-tool.md).

## Image previews

The optional `image-display` tool renders images from the active worktree or
`~/debian/generated-images` through Chafa. Its default mode lets Chafa select
Kitty, iTerm2, Sixel, or symbols for the attached terminal; `symbols` provides
a portable ANSI/Unicode fallback when a graphics protocol is filtered over
SSH. See [ADR-0014](docs/decisions/0014-terminal-image-preview.md).

## The YubiKey/security-key notification

If you forward an SSH agent backing a FIDO2/U2F security key into a remote
box, `bin/yknotify-agent` sits transparently between the remote client and
the forwarded agent. When it sees a `SIGN_REQUEST` for an `sk-*` key, it
identifies the calling process, and announces on two independent channels — an
OSC 777 desktop notification (supported natively by
[Warp](https://docs.warp.dev/terminal/more-features/notifications/)) and a
short chime — so you know *what* is asking for your touch, not just that
something is.

The sound matters as much as the notification: a banner helps only while you
are looking at the window, which is not the case when a touch goes unnoticed.
The chime is generated by `bin/yknotify-son` on first use, and played to
whatever audio server `PULSE_SERVER` points at — useful when the agent runs on
a machine with no sound device of its own. Set `YKNOTIFY_SON=""` to keep the
notifications and drop the sound.

If a Git or SSH operation fails with `agent refused operation`, `signing
failed` or `Permission denied (publickey)`, that is almost certainly not a
misconfiguration — a notification asked for a touch and went unnoticed. Touch
the key and retry the same command; nothing needs changing.

Full rationale, threat model and what was actually tested:
[docs/decisions/0004](docs/decisions/0004-yubikey-agent-proxy.md).

## Untrusted repositories

OpenCode plugins run inside the OpenCode process, outside its own permission
model. Don't open a repo you don't trust with its project plugins active:

```bash
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode              # keep global plugins
OPENCODE_PURE=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode  # hostile repo
```

Details: [docs/decisions/0003](docs/decisions/0003-untrusted-repositories.md).

## License

MIT — see [LICENSE](LICENSE).
