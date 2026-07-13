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
