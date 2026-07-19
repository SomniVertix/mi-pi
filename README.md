# mi-pi

Personal [pi](https://github.com/badlogic/pi-mono) extensions.

## Extensions

### skill-precheck

Deterministic gating for skills. A skill opts in via `SKILL.md` frontmatter:

```yaml
---
name: my-skill
description: ...
metadata:
  precheck: /path/to/script.py   # absolute, or relative to the skill dir
---
```

When a gated skill is invoked — either via `/skill:name` or via the model
reading its `SKILL.md` — the script runs first with `python3`. Exit 0 lets
the skill proceed; any other exit code blocks it, and stderr is shown to the
user (not the model).

The script receives Claude-Code-hook-compatible JSON on stdin:

```json
{ "prompt": "<raw input>", "cwd": "<cwd>", "skill": "<name>", "args": "<args after command>" }
```

This means scripts written as Claude Code `UserPromptSubmit` hooks work with
minimal changes.

Details:

- Gated skills are discovered at `session_start` across all standard skill
  locations; pick up changes with `/reload`
- 30s script timeout; missing script or spawn failure blocks the skill
- A per-agent-run pass-cache prevents re-running the script when the model
  reads a `SKILL.md` right after a passing `/skill:` invocation

## Skills

### diy

The `.dot/diy` Standard: a portable mechanism any repo can adopt to give
people who pull it down a real, interactive walkthrough of the product's key
architectural decisions — not just static docs, but a live `/diy` session
that teaches those decisions and lets the person keep or swap each one,
ending in a portable build brief any AI coding tool can build a fork from.

Two roles use it, at different times:

- **The maintainer** authors or refreshes the decisions catalog
  (`decisions.yaml`) — the record of what was decided and why. This can be
  done autonomously via the `diy-cataloger` agent, interactively with
  guidance, or fully by hand.
- **The protégé** — someone who pulled the repo down to build their own
  variant — walks through the catalog and ends up with a `build-brief.yaml`
  spec-ing what to keep, swap, or revisit.

The files under `skills/diy/` are the mechanism itself: repo-agnostic and
containing no knowledge of any specific product. They're meant to ship
unmodified into any adopting repo's `.dot/diy/` directory. See
[`skills/diy/README.md`](skills/diy/README.md) for the full breakdown and
setup steps to make `/diy` locally invokable after cloning.

## Tests

```bash
npm test
```

See [`tests/README.md`](tests/README.md) for details. Tests that depend on
personal skills (e.g. `grilling`) skip gracefully when the skill isn't
installed locally.

## Install

Via pi packages:

```bash
pi install git:github.com/SomniVertix/mi-pi
```

Or point a local clone in `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/mi-pi/extensions/skill-precheck.ts"]
}
```
