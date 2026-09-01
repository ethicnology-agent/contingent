import type { Plugin } from "@opencode-ai/plugin"

// Git identity plugin for opencode agents.
//
// Why: the author of a commit is the human accountable for the repository
// (ethicnology); the committer is the agent identity that actually ran the
// command, so it acts as an audit marker. Agent commits are deliberately
// left unsigned by default: since the human's global git config signs
// everything by default, an *unsigned* commit is proof an agent touched it,
// and a *signed* commit is proof no agent ever did.
//
// There is no dedicated env var for `commit.gpgsign`, so we override it via
// the generic GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n
// mechanism. `git -c commit.gpgsign=true commit ...` still wins over this
// override — that is the deliberate escape hatch for explicit, user-requested
// signing (see AGENTS.md).
//
// The same mechanism routes agent git traffic over HTTPS. The only SSH key on
// this machine belongs to the human account, so an agent pushing over SSH
// would authenticate as the human — with the human's privileges, and with a
// YubiKey touch. Rewriting to HTTPS makes agent pushes carry the dedicated
// `ethicnology-agent` token instead, whose blast radius is limited to its own
// forks. The human's own terminal never sees these overrides and keeps SSH.

const AGENT_GIT_AUTHOR_NAME = "ethicnology"
const AGENT_GIT_AUTHOR_EMAIL = "ethicnology@pm.me"
const AGENT_GIT_COMMITTER_NAME = "ethicnology-agent"
const AGENT_GIT_COMMITTER_EMAIL = "ethicnology+agent@pm.me"

const AGENT_GIT_CONFIG: ReadonlyArray<readonly [string, string]> = [
  // Unsigned by default; `git -c commit.gpgsign=true` remains the opt-in.
  ["commit.gpgsign", "false"],
  // Force agent traffic off SSH so it authenticates with the agent token.
  ["url.https://github.com/.insteadOf", "git@github.com:"],
  ["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
  ["credential.https://github.com.helper", "!gh auth git-credential"],
]

// `output.env` is not a set of additions: it *becomes* the environment of the
// shell. As long as no plugin implements this hook, opencode passes its own
// environment through; declaring it makes this plugin responsible for the
// whole thing. Without the pass-through below, PATH collapses to the systemd
// default — losing rtk, fvm, cargo and platform-tools — and ANDROID_HOME,
// ADB_*_SOCKET, PROXY_URL and friends disappear from every agent shell.
//
// Names that look like credentials are deliberately not propagated: secrets
// live in files read on demand, never in the environment of every command an
// agent runs.
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY$|^.*API_KEY/i

// Variables this hook sets authoritatively below. Inheriting them too would
// append our overrides on top of the parent's and grow GIT_CONFIG_COUNT on
// every nesting level, so the hook is kept idempotent by dropping them.
const OWNED_NAME = /^GIT_(AUTHOR|COMMITTER|CONFIG)_/

const inheritParentEnvironment = (env: Record<string, string>) => {
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name in env) continue
    if (SECRET_NAME.test(name) || OWNED_NAME.test(name)) continue
    env[name] = value
  }
}

export const GitIdentityPlugin: Plugin = async () => {
  return {
    "shell.env": async (_input, output) => {
      inheritParentEnvironment(output.env)

      const localBin = `${process.env.HOME ?? ""}/.local/bin`
      const path = output.env.PATH ?? ""
      if (localBin !== "/.local/bin" && !path.split(":").includes(localBin)) {
        output.env.PATH = path ? `${localBin}:${path}` : localBin
      }

      output.env.GIT_AUTHOR_NAME = AGENT_GIT_AUTHOR_NAME
      output.env.GIT_AUTHOR_EMAIL = AGENT_GIT_AUTHOR_EMAIL
      output.env.GIT_COMMITTER_NAME = AGENT_GIT_COMMITTER_NAME
      output.env.GIT_COMMITTER_EMAIL = AGENT_GIT_COMMITTER_EMAIL

      // Append without clobbering a preexisting GIT_CONFIG_* override the
      // environment might already carry.
      const rawCount = output.env.GIT_CONFIG_COUNT
      const parsedCount = rawCount ? Number.parseInt(rawCount, 10) : 0
      let index = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : 0

      for (const [key, value] of AGENT_GIT_CONFIG) {
        output.env[`GIT_CONFIG_KEY_${index}`] = key
        output.env[`GIT_CONFIG_VALUE_${index}`] = value
        index += 1
      }
      output.env.GIT_CONFIG_COUNT = String(index)
    },
  }
}
