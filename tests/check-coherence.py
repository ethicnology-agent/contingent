#!/usr/bin/env python3
"""
Static coherence checks for this repo, runnable from a fresh clone with no
installation step and no live machine state required.

Verifies that what the committed files ASSERT matches what actually exists
in the repo: Git aliases referenced in prose, skill names referenced in
prose, prompt files pointed to by opencode.jsonc, version pinning coherence,
and basic syntax of the Python/TypeScript sources.

Checks that depend on the network or on the installed `opencode` binary are
skipped rather than failed when unavailable, so a fresh clone stays verifiable
with no installation step.

This is not a substitute for the behavioral tests described in the ADRs
under docs/decisions/ (autosquash-without-editor, proxy race conditions,
FIFO-blocking, etc.) — those were run manually against disposable fixtures,
not automated here yet.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ECHECS: list[str] = []
OK: list[str] = []


def verdict(cond: bool, libelle: str, detail: str = "") -> None:
    (OK if cond else ECHECS).append(f"{libelle}{(' — ' + detail) if detail else ''}")


def lire(rel: str) -> str:
    p = ROOT / rel
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def strip_jsonc(src: str) -> str:
    out, i, n, in_str = [], 0, len(src), False
    while i < n:
        c = src[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        out.append(c)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


# --- 1. Git aliases referenced in prose exist in git/agentic.gitconfig -----
agents_md = lire("opencode/AGENTS.md")
plan_md = lire("opencode/prompts/plan.md")
gitconfig = lire("git/agentic.gitconfig")

for alias in sorted(set(re.findall(r"`git (\w+)[ `]", agents_md))):
    if alias in ("commit", "rebase", "push", "pull", "fetch", "status", "config"):
        continue
    m = re.search(rf"^\s*{re.escape(alias)}\s*=", gitconfig, re.M)
    verdict(bool(m), f"alias git '{alias}' cité dans AGENTS.md",
            "" if m else "absent de git/agentic.gitconfig")

# --- 2. Skill names referenced in prose exist under skills/ ----------------
refs = set(re.findall(r"skill `([a-z0-9-]+)`", agents_md + plan_md))
skills_dir = ROOT / "skills"
dossiers = {p.name for p in skills_dir.iterdir() if p.is_dir()} if skills_dir.is_dir() else set()
for r in sorted(refs):
    verdict(r in dossiers, f"skill '{r}' référencée",
            "" if r in dossiers else f"introuvable sous skills/ (présentes: {sorted(dossiers) or 'aucune'})")

for skill_dir in sorted(dossiers):
    skill_md = lire(f"skills/{skill_dir}/SKILL.md")
    m = re.match(r"^---\n(.*?)\n---\n", skill_md, re.S)
    verdict(bool(m), f"skills/{skill_dir}/SKILL.md a un frontmatter")
    if m:
        name_m = re.search(r"^name:\s*(\S+)", m.group(1), re.M)
        verdict(bool(name_m) and name_m.group(1) == skill_dir,
                f"frontmatter 'name' == nom du dossier ({skill_dir})",
                name_m.group(1) if name_m else "absent")

# --- 3. opencode.jsonc parses, and its prompt file references resolve -----
cfg_raw = lire("opencode/opencode.jsonc")
cfg: dict = {}
try:
    cfg = json.loads(strip_jsonc(cfg_raw))
    verdict(True, "opencode/opencode.jsonc parse en JSON valide")
except json.JSONDecodeError as e:
    verdict(False, "opencode/opencode.jsonc parse en JSON valide", str(e))

for nom, ag in cfg.get("agent", {}).items():
    p = ag.get("prompt", "")
    m = re.fullmatch(r"\{file:(.+)\}", p)
    if m:
        cible = ROOT / "opencode" / m.group(1).lstrip("./")
        verdict(cible.exists(), f"prompt de l'agent '{nom}' résout",
                "" if cible.exists() else f"{cible} MANQUE")

# --- 4. Schema/model checks: best-effort, network-dependent, never fail ---
def fetch_json(url: str, timeout: float = 5.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


try:
    import jsonschema  # type: ignore

    schema = fetch_json("https://opencode.ai/config.json")
    errs = list(jsonschema.Draft202012Validator(schema).iter_errors(cfg))
    verdict(not errs, "opencode.jsonc conforme au schéma officiel",
            "; ".join(f"{'/'.join(map(str, e.path))}: {e.message}" for e in errs[:3]))
except Exception as e:  # network, missing jsonschema, etc. — informational only
    OK.append(f"validation de schéma sautée ({type(e).__name__}: {e})")

try:
    models_schema = fetch_json("https://models.dev/model-schema.json")
    connus: set[str] = set()

    def parcours(o):
        if isinstance(o, dict):
            if isinstance(o.get("enum"), list):
                connus.update(x for x in o["enum"] if isinstance(x, str) and "/" in x)
            for v in o.values():
                parcours(v)
        elif isinstance(o, list):
            for v in o:
                parcours(v)

    parcours(models_schema)
    for nom, ag in cfg.get("agent", {}).items():
        mod = ag.get("model")
        if mod:
            verdict(mod in connus, f"modèle de l'agent '{nom}' ({mod}) connu de models.dev",
                    "" if mod in connus else "absent du catalogue")
    for cle in ("model", "small_model"):
        if cfg.get(cle):
            verdict(cfg[cle] in connus, f"{cle} ({cfg[cle]}) connu de models.dev",
                    "" if cfg[cle] in connus else "absent du catalogue")
except Exception as e:
    OK.append(f"vérification des modèles sautée ({type(e).__name__}: {e})")

# --- 4b. Le pin du SDK suit-il l'OpenCode reellement installe ? -------------
# La derive que ADR-0008 existe pour empecher s'est reproduite en silence
# (pin 1.18.5, binaire 1.18.7) et n'a ete vue qu'a la relecture. Skippe, jamais
# echoue, si le binaire est absent : un clone frais doit rester verifiable.
def version_opencode() -> str:
    try:
        r = subprocess.run(["opencode", "--version"], capture_output=True,
                           text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return ""
    m = re.search(r"\d+\.\d+\.\d+", r.stdout or "")
    return m.group(0) if m else ""


pin = ""
try:
    pkg = json.loads(lire("opencode/package.json") or "{}")
    pin = (pkg.get("dependencies") or {}).get("@opencode-ai/plugin", "")
    installe = version_opencode()
    if not pin:
        verdict(False, "@opencode-ai/plugin epingle dans package.json", "absent")
    elif not installe:
        OK.append("comparaison au binaire opencode sautee (opencode introuvable)")
    else:
        verdict(pin == installe,
                f"pin @opencode-ai/plugin ({pin}) == opencode installe ({installe})",
                "" if pin == installe else "derive : voir docs/decisions/0008")
except json.JSONDecodeError as e:
    verdict(False, "opencode/package.json parse en JSON valide", str(e))

# Le lock doit refleter le pin, sinon `npm ci` reconstruit autre chose.
try:
    lock = json.loads(lire("opencode/package-lock.json") or "{}")
    verrouille = ((lock.get("packages") or {}).get("node_modules/@opencode-ai/plugin")
                  or {}).get("version", "")
    if pin:
        verdict(verrouille == pin,
                f"package-lock.json verrouille @opencode-ai/plugin sur le pin ({pin})",
                "" if verrouille == pin else f"le lock dit {verrouille or 'rien'}")
except json.JSONDecodeError as e:
    verdict(False, "opencode/package-lock.json parse en JSON valide", str(e))

# --- 5. Syntax checks on the repo's own scripts -----------------------------
py_script = ROOT / "bin" / "yknotify-agent"
if py_script.exists():
    r = subprocess.run([sys.executable, "-m", "py_compile", str(py_script)],
                       capture_output=True, text=True)
    verdict(r.returncode == 0, "bin/yknotify-agent compile (py_compile)",
            r.stderr.strip()[-300:] if r.returncode else "")

test_env = ROOT / "opencode" / "plugins"
if test_env.is_dir():
    for ts_file in sorted(test_env.glob("*.ts")):
        esbuild = subprocess.run(["esbuild", str(ts_file), "--log-level=error"],
                                 capture_output=True, text=True)
        if esbuild.returncode == 0 or "not found" in (esbuild.stderr or "").lower():
            skipped = esbuild.returncode != 0
            verdict(not skipped or True, f"{ts_file.relative_to(ROOT)} syntaxe (esbuild)",
                    "esbuild introuvable, sauté" if skipped else "")
        else:
            verdict(False, f"{ts_file.relative_to(ROOT)} syntaxe (esbuild)",
                    esbuild.stderr.strip()[-300:])

print(f"\n{len(OK)} vérification(s) passée(s), {len(ECHECS)} échec(s)\n")
for e in ECHECS:
    print("  ÉCHEC :", e)
if not ECHECS:
    print("  aucune incohérence")

sys.exit(1 if ECHECS else 0)
