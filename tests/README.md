# mi-pi tests

Integration tests that exercise the extensions in this repo against real
skill/tool wiring. No unit-test framework — each test is a self-contained
shell script that mirrors the extension's actual runtime behavior against
the real filesystem and any local tools it depends on.

## Running

```bash
# Everything
npm test

# Or directly
./tests/run-all.sh

# One test
./tests/skill-precheck/grilling-integration.sh
```

## Contract for test scripts

- Exit `0` on pass **or** graceful skip (missing optional dependency).
- Exit non-zero on real failure.
- Print human-readable output to stdout; the runner does not parse it.
- Clean up their own temp dirs (use `mktemp -d` + `trap ... EXIT`).
- Never require network access or write outside `mktemp` dirs.

## Existing tests

### `skill-precheck/grilling-integration.sh`

End-to-end test of `extensions/skill-precheck.ts` driving the `grilling`
skill's precheck script (`~/.claude/skills/grilling/scripts/init-session.py`).

Validates every seam between the extension and the target skill:

1. `SKILL.md` frontmatter matches the extension's `name` / `precheck`
   discovery regexes.
2. The precheck script path resolves (absolute or relative to skill dir).
3. `python3` is on PATH (the extension hardcodes it).
4. The script honors the extension's stdin JSON contract
   (`{ prompt, cwd, skill, args }`).
5. The script exits well under the extension's 30s SIGKILL timeout.
6. The script's stdout is non-empty (otherwise the extension skips
   injection into the model context).
7. The seeded `decisions.md` has every field downstream stages read.
8. The wrapped `<skill-precheck-context>` block includes the tracker path
   so the interview agent knows where to write.
9. Ollama-failure fallback still exits 0 with a valid artifact and a
   warning on stderr (never stdout).
10. Duplicate invocation gets a `-2` suffix, no clobber.
11. Script's internal Ollama timeout leaves headroom under the extension's
    SIGKILL timeout.

Gracefully skips (exit 0) if the `grilling` skill isn't installed on this
machine — it's a personal skill, not part of mi-pi. Ollama sub-checks skip
individually when Ollama or `gemma3` isn't available.
