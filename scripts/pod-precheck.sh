#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Modernization Harness — pod pre-check (READ ONLY, OCR-friendly, OPTIONAL)
#
# Confirms the internal npm mirror can resolve the packages the harness will
# depend on, and reports the Playwright browser version cached on the pod so we
# can pin the matching package (no re-download behind the proxy). Read-only:
# only `npm view` (mirror lookups) + version/dir listings. No secrets printed.
#
#   bash pod-precheck.sh            # writes ~/harness-precheck.txt
# Then open it in VS Code (Word Wrap off) and screenshot/OCR — it's short.
# ---------------------------------------------------------------------------

OUT="${1:-$HOME/harness-precheck.txt}"
: > "$OUT"
line() { printf '%s\n' "$1" >> "$OUT"; }

line "===== HARNESS POD PRE-CHECK ====="
line "generated: $(date -u +%FT%TZ 2>/dev/null)"
line "node: $(node -v 2>&1)   npm: $(npm -v 2>&1)   registry: $(npm config get registry 2>&1)"
line ""

line "----- Playwright browsers cached on pod -----"
ls -1 "$HOME/.cache/ms-playwright" 2>/dev/null | sed 's/^/  /' >> "$OUT" || line "  (none)"
line ""

line "----- npm-mirror resolution (pkg : latest version, or MISSING) -----"
# Packages the harness depends on across milestones (runtime + key dev tools).
PKGS="commander picocolors @inquirer/prompts better-sqlite3 yaml zod \
fast-xml-parser web-tree-sitter gpt-tokenizer odiff-bin pixelmatch sqlite-vec \
@anthropic-ai/sdk @modelcontextprotocol/sdk playwright @playwright/test \
axe-core vitest typescript eslint prettier"
for p in $PKGS; do
  v="$(npm view "$p" version 2>/dev/null | tail -1)"
  if [ -n "$v" ]; then
    printf '  %-28s %s\n' "$p" "$v" >> "$OUT"
  else
    printf '  %-28s MISSING\n' "$p" >> "$OUT"
  fi
done
line ""
line "===== END ($(wc -l < "$OUT" 2>/dev/null | tr -d ' ') lines) ====="
printf '\nDONE -> %s\n' "$OUT"
printf 'Anything marked MISSING means the Nexus mirror does not proxy it — tell Claude so a fallback can be chosen.\n'
