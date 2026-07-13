#!/usr/bin/env bash
# Run every test under tests/. Each test is an executable script that exits
# non-zero on failure and 0 on pass (or skip). Exit code is the count of
# failing tests, capped at 255.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
FAILED=0
TOTAL=0

# Find all .sh files under tests/, excluding this runner
while IFS= read -r -d '' t; do
  [ "$t" = "$HERE/run-all.sh" ] && continue
  TOTAL=$((TOTAL+1))
  printf "\n\033[1;36m=== %s ===\033[0m\n" "${t#$HERE/}"
  if bash "$t"; then :
  else FAILED=$((FAILED+1)); fi
done < <(find "$HERE" -type f -name '*.sh' -print0 | sort -z)

echo
if [ $FAILED -eq 0 ]; then
  printf "\033[1;32m%d/%d test file(s) passed.\033[0m\n" $TOTAL $TOTAL
  exit 0
else
  printf "\033[1;31m%d/%d test file(s) failed.\033[0m\n" $FAILED $TOTAL
  exit $((FAILED > 255 ? 255 : FAILED))
fi
