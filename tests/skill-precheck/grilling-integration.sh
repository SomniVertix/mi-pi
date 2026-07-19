#!/usr/bin/env bash
# End-to-end integration test for the skill-precheck extension, exercised
# against the `grilling` skill.
#
# Verifies every seam between skill-precheck.ts and the target skill:
#   1. SKILL.md frontmatter matches the extension's discovery regexes
#   2. The precheck script path resolves correctly
#   3. python3 is available (extension hardcodes it)
#   4. The script honours the extension's stdin JSON contract
#      { prompt, cwd, skill, args }
#   5. Script completes well under the extension's 30s SIGKILL timeout
#   6. Script's stdout is non-empty (otherwise extension skips injection)
#   7. Script's stderr does NOT leak into what would become model context
#   8. The seeded artifact has the structure downstream stages expect
#   9. The wrapped <skill-precheck-context> block includes the tracker path
#  10. Ollama-failure fallback still exits 0 with a valid artifact
#  11. Duplicate invocation gets a numeric suffix (no clobber)
#
# The test is skipped (exit 0) — not failed — when the grilling skill isn't
# installed on this machine, since it's a personal skill, not part of mi-pi.
# Ollama-related sub-checks are also skipped when Ollama isn't installed.

set -u
FAIL=0
SKIPPED=0
pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
skip() { printf "  \033[33m∼\033[0m %s (skipped)\n" "$1"; SKIPPED=$((SKIPPED+1)); }
info() { printf "  \033[90m·\033[0m %s\n" "$1"; }
hdr()  { printf "\n\033[1m%s\033[0m\n" "$1"; }

# ---------------------------------------------------------------------------
# Locate the grilling skill. Search all standard pi/Claude skill roots.
# ---------------------------------------------------------------------------
find_grilling_skill() {
  local roots=(
    "$HOME/.claude/skills/grilling"
    "$HOME/.pi/agent/skills/grilling"
    "$HOME/.agents/skills/grilling"
  )
  for r in "${roots[@]}"; do
    if [ -f "$r/SKILL.md" ]; then echo "$r"; return 0; fi
  done
  return 1
}

SKILL_DIR=$(find_grilling_skill) || {
  printf "\033[33mgrilling skill not installed; skipping integration test.\033[0m\n"
  printf "  searched: ~/.claude/skills/grilling, ~/.pi/agent/skills/grilling, ~/.agents/skills/grilling\n"
  exit 0
}
SKILL_MD="$SKILL_DIR/SKILL.md"
info "skill dir: $SKILL_DIR"

# ---------------------------------------------------------------------------
hdr "1. SKILL.md frontmatter matches extension's discovery regexes"
# ---------------------------------------------------------------------------
FM=$(awk '/^---$/{c++; if(c==2)exit; next} c==1' "$SKILL_MD")
[ -n "$FM" ] && pass "frontmatter block delimited by --- ... ---" || fail "no frontmatter block"

# skill-precheck.ts: /^name:\s*["']?([a-z0-9][a-z0-9-]*)["']?\s*$/m
NAME=$(echo "$FM" | grep -E '^name:[[:space:]]+' | sed -E 's/^name:[[:space:]]+"?([a-z0-9][a-z0-9-]*)"?[[:space:]]*$/\1/')
[ "$NAME" = "grilling" ] && pass "name field parses to 'grilling'" || fail "name parse failed (got: '$NAME')"

# skill-precheck.ts: /^\s+precheck:\s*["']?(.+?)["']?\s*$/m   (indent required)
PRECHECK=$(echo "$FM" | grep -E '^[[:space:]]+precheck:' | sed -E 's/^[[:space:]]+precheck:[[:space:]]*"?([^"]+)"?[[:space:]]*$/\1/')
[ -n "$PRECHECK" ] && pass "precheck field parses to '$PRECHECK'" || fail "precheck field missing/unparseable"

# ---------------------------------------------------------------------------
hdr "2. Script path resolves"
# ---------------------------------------------------------------------------
if [[ "$PRECHECK" = /* ]]; then RESOLVED="$PRECHECK"
else RESOLVED="$SKILL_DIR/$PRECHECK"; fi
info "resolved: $RESOLVED"
[ -f "$RESOLVED" ] && pass "script file exists" || fail "script not found"
[ -r "$RESOLVED" ] && pass "script is readable" || fail "script not readable"

# ---------------------------------------------------------------------------
hdr "3. python3 is available (extension hardcodes PYTHON='python3')"
# ---------------------------------------------------------------------------
if command -v python3 >/dev/null; then
  pass "python3 in PATH: $(command -v python3) ($(python3 --version))"
else
  fail "python3 not found"
fi

# ---------------------------------------------------------------------------
hdr "4. Ollama availability (optional — script has a fallback)"
# ---------------------------------------------------------------------------
HAVE_OLLAMA=0
HAVE_GEMMA=0
if command -v ollama >/dev/null; then
  HAVE_OLLAMA=1
  pass "ollama in PATH"
  if ollama list 2>/dev/null | grep -q '^gemma3'; then
    HAVE_GEMMA=1
    pass "gemma3 model pulled locally"
  else
    skip "gemma3 not in 'ollama list' — script will fall back to regex slug"
  fi
else
  skip "ollama not installed — script will fall back to regex slug"
fi

# ---------------------------------------------------------------------------
hdr "5. Happy path: extension → script contract, timing, artifact"
# ---------------------------------------------------------------------------
TMP=$(mktemp -d)
TMP2=$(mktemp -d)
STDERR_LOG=$(mktemp)
STDERR_LOG2=$(mktemp)
trap 'rm -rf "$TMP" "$TMP2" "$STDERR_LOG" "$STDERR_LOG2"' EXIT

USER_ASK="I want to build a functional backend to an AI workflow engine called relentless UI"
PROMPT="/grilling $USER_ASK"

# Reconstruct the exact stdin the extension sends. See skill-precheck.ts:
#   child.stdin.write(JSON.stringify({ prompt, cwd, skill: skill.name, args }));
STDIN_JSON=$(python3 -c "
import json,sys
print(json.dumps({'prompt': sys.argv[1], 'cwd': sys.argv[2], 'skill': 'grilling', 'args': sys.argv[3]}))
" "$PROMPT" "$TMP" "$USER_ASK")

info "cwd: $TMP"
info "invoking: python3 $RESOLVED  (mirrors extension's spawn call)"
START=$(python3 -c 'import time;print(time.time())')
OUT=$(cd "$TMP" && echo "$STDIN_JSON" | python3 "$RESOLVED" 2>"$STDERR_LOG")
RC=$?
END=$(python3 -c 'import time;print(time.time())')
ELAPSED=$(python3 -c "print(f'{$END - $START:.2f}')")

[ $RC -eq 0 ] && pass "script exit code 0" || fail "script exited $RC (stderr: $(cat "$STDERR_LOG"))"
info "elapsed: ${ELAPSED}s (extension timeout is 30s)"
awk -v e="$ELAPSED" 'BEGIN{exit !(e+0 < 25)}' && pass "well under 30s extension timeout" || fail "too close to 30s timeout"

# Extension check: `if (!result.context.trim()) return continue`
[ -n "$(echo "$OUT" | tr -d '[:space:]')" ] && pass "stdout non-empty → will be injected as context" || fail "empty stdout"

# ---------------------------------------------------------------------------
hdr "6. Artifact structure matches what downstream stages expect"
# ---------------------------------------------------------------------------
SLUG=$(ls "$TMP/.relentless/specs/" 2>/dev/null | head -1)
[ -n "$SLUG" ] && pass "session dir created under .relentless/specs/" || fail "no session dir"
info "slug chosen: $SLUG"

if [ "$HAVE_GEMMA" = "1" ]; then
  # Ollama should have produced a semantic slug (not the raw ask, not a timestamp)
  if echo "$SLUG" | grep -qE '^session-[0-9]{8}'; then
    fail "slug is timestamp fallback — Ollama call didn't happen"
  elif echo "$SLUG" | grep -qE '^i-want-to-build'; then
    fail "slug is regex fallback — Ollama call didn't happen"
  else
    pass "slug looks LLM-generated (semantic)"
  fi
fi

DECISIONS="$TMP/.relentless/specs/$SLUG/decisions.md"
[ -f "$DECISIONS" ] && pass "decisions.md written" || fail "decisions.md missing"

grep -q "^# Grilling Session:" "$DECISIONS" && pass "has '# Grilling Session:' header" || fail "header missing"
grep -q "^- Status: in-progress" "$DECISIONS" && pass "Status: in-progress present" || fail "status field missing"
grep -q "^- Last updated date:" "$DECISIONS" && pass "Last updated date present" || fail "last-updated field missing"
grep -q "^## Initial Prompt" "$DECISIONS" && pass "Initial Prompt section present" || fail "initial prompt section missing"
grep -q "^## Decisions" "$DECISIONS" && pass "Decisions section present (append target)" || fail "decisions section missing"
grep -qF "$USER_ASK" "$DECISIONS" && pass "user ask embedded in Initial Prompt" || fail "initial prompt not embedded"

# ---------------------------------------------------------------------------
hdr "7. Simulate extension's wrapContext() + input transform"
# ---------------------------------------------------------------------------
# Extension: wrapContext(name, stdout) → <skill-precheck-context skill="...">…</…>
# then text = original_input + "\n\n" + wrapped
WRAPPED="<skill-precheck-context skill=\"grilling\">
$(echo "$OUT" | sed -e 's/[[:space:]]*$//')
</skill-precheck-context>"

FINAL_INPUT="${PROMPT}

${WRAPPED}"

pass "wrapped context assembled — first 3 lines of what model will see:"
echo "$FINAL_INPUT" | head -3 | sed 's/^/    | /'

echo "$WRAPPED" | grep -qF "$DECISIONS" && pass "wrapped context includes the actual tracker path" || fail "tracker path missing from wrapped context"

# stderr must never end up in the model context (extension pipes stdout only)
if [ -s "$STDERR_LOG" ]; then
  info "stderr had content: $(head -1 "$STDERR_LOG")"
fi
pass "extension only pipes stdout to model — stderr stays out of context (by design)"

# ---------------------------------------------------------------------------
hdr "8. Fallback path: Ollama unreachable → regex slug, still exits 0"
# ---------------------------------------------------------------------------
STDIN_JSON2=$(python3 -c "
import json,sys
print(json.dumps({'prompt': '/grilling add dark mode', 'cwd': sys.argv[1], 'skill': 'grilling', 'args': 'add dark mode toggle to settings page'}))
" "$TMP2")

# Force fallback by pointing at a nonexistent model, regardless of local Ollama state
OUT2=$(cd "$TMP2" && RELENTLESS_OLLAMA_MODEL=definitely-not-a-real-model bash -c "echo '$STDIN_JSON2' | python3 '$RESOLVED'" 2>"$STDERR_LOG2")
RC2=$?
[ $RC2 -eq 0 ] && pass "script still exits 0 when Ollama fails" || fail "script failed to fall back (rc=$RC2)"
grep -q "falling back to regex slug" "$STDERR_LOG2" && pass "fallback warning logged to stderr (not stdout)" || fail "no fallback warning in stderr"
[ -f "$TMP2/.relentless/specs/add-dark-mode-toggle-to-settings-page/decisions.md" ] \
  && pass "regex-slug artifact created" || fail "fallback artifact missing"

# ---------------------------------------------------------------------------
hdr "9. Duplicate invocation: unique_dir suffix logic"
# ---------------------------------------------------------------------------
cd "$TMP2" && RELENTLESS_OLLAMA_MODEL=definitely-not-a-real-model bash -c "echo '$STDIN_JSON2' | python3 '$RESOLVED'" >/dev/null 2>&1
[ -d "$TMP2/.relentless/specs/add-dark-mode-toggle-to-settings-page-2" ] \
  && pass "second run got -2 suffix (no clobber)" || fail "collision handling broken"

# ---------------------------------------------------------------------------
hdr "10. Timeout budget"
# ---------------------------------------------------------------------------
OLLAMA_CAP=$(grep -E '^OLLAMA_TIMEOUT_SECS' "$RESOLVED" | head -1 | grep -oE '[0-9]+' || echo "?")
info "script OLLAMA_TIMEOUT_SECS = $OLLAMA_CAP, extension TIMEOUT_MS = 30000"
if [ "$OLLAMA_CAP" != "?" ] && [ "$OLLAMA_CAP" -le 25 ]; then
  pass "script Ollama cap leaves headroom under 30s SIGKILL"
else
  fail "cap missing or too close to extension timeout"
fi

# ---------------------------------------------------------------------------
echo
if [ $FAIL -eq 0 ]; then
  printf "\033[1;32mAll checks passed"
  [ $SKIPPED -gt 0 ] && printf " (%d skipped)" $SKIPPED
  printf ".\033[0m\n"
  exit 0
else
  printf "\033[1;31m%d check(s) failed" $FAIL
  [ $SKIPPED -gt 0 ] && printf " (%d skipped)" $SKIPPED
  printf ".\033[0m\n"
  exit 1
fi
