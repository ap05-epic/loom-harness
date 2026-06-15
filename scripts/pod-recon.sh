#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Modernization Harness — pod recon (READ ONLY, OCR-friendly)
#
# Gathers the environment + DIGIT/Copilot layout + existing skills/agents the
# harness needs for onboarding. It ONLY reads: versions, file listings, and the
# contents of DOC/CONFIG files with secrets redacted. It never prints API keys,
# never reads credential/state files (e.g. auth_state.json), and sends nothing
# anywhere — it just writes one local text file you can open and OCR.
#
# Usage:
#   bash pod-recon.sh                # writes ~/harness-recon.txt
#   INCLUDE_REFS=1 bash pod-recon.sh # also dump skill reference docs (longer)
# Then open the file in VS Code (View > Word Wrap = off) and screenshot pages.
# ---------------------------------------------------------------------------

OUT="${1:-$HOME/harness-recon.txt}"
: > "$OUT"

line() { printf '%s\n' "$1" >> "$OUT"; }
hr()   { printf '\n===== %s =====\n\n' "$1" >> "$OUT"; }

# Mask common secret shapes so nothing sensitive lands in the report.
redact() {
  sed -E \
    -e 's#eyJ[A-Za-z0-9_.-]{8,}#<REDACTED_JWT>#g' \
    -e 's#sk-[A-Za-z0-9_-]{8,}#<REDACTED_KEY>#g' \
    -e 's#(API_?KEY|APIKEY|TOKEN|SECRET|PASSWORD|MASTER_KEY|BEARER)([[:space:]]*[:=][[:space:]]*).*#\1\2<REDACTED>#Ig'
}

dump() { # dump <path> [maxlines]
  local p="$1" max="${2:-400}" n
  if [ ! -e "$p" ]; then line "----- FILE: $p -----"; line "(MISSING)"; line "----- END -----"; return; fi
  n="$(wc -l < "$p" 2>/dev/null | tr -d ' ')"
  line "----- FILE: $p (${n} lines) -----"
  redact < "$p" | head -n "$max" >> "$OUT"
  [ "${n:-0}" -gt "$max" ] 2>/dev/null && line "...(truncated at ${max} lines)..."
  line "----- END -----"
}

hr "HARNESS POD RECON v1"
line "generated: $(date -u +%FT%TZ 2>/dev/null)"
line "host: $(hostname 2>/dev/null)   user: $(id -un 2>/dev/null)   cwd: $(pwd)"

hr "SECTION 1 :: POD ENVIRONMENT"
line "node: $(node -v 2>&1)    npm: $(npm -v 2>&1)    pnpm: $(pnpm -v 2>&1 || echo ABSENT)"
line "corepack: $(corepack -v 2>&1 || echo ABSENT)    git: $(git --version 2>&1)"
line "java: $(java -version 2>&1 | head -1)    docker: $(docker -v 2>&1 || echo ABSENT)"
line "os: $(uname -srm 2>&1)    glibc: $(ldd --version 2>&1 | head -1)"
line "disk(HOME): $(df -h "$HOME" 2>/dev/null | awk 'NR==2{print $4" free / "$2}')"
line "npm registry: $(npm config get registry 2>&1)"
line "proxy: HTTP_PROXY=${HTTP_PROXY:-unset} HTTPS_PROXY=${HTTPS_PROXY:-unset} NO_PROXY=${NO_PROXY:-unset}"
line "public clone: $(git ls-remote https://github.com/sindresorhus/is.git HEAD 2>&1 | head -1)"
line "playwright cdn: $(curl -sS -o /dev/null -w 'HTTP %{http_code}' --max-time 20 https://playwright.azureedge.net/ 2>&1)"
line "playwright browsers present: $(ls ~/.cache/ms-playwright 2>/dev/null | tr '\n' ' ' || echo none)"

hr "SECTION 2 :: DIGIT / COPILOT LAYOUT"
line "which dc: $(command -v dc 2>&1)    which copilot: $(command -v copilot 2>&1)"
line "copilot version: $(copilot --version 2>&1 | head -1)"
for d in "$HOME/.copilot" "$HOME/.copilot/agents" "$HOME/.copilot/skills" "$HOME/.config/digitcode"; do
  line "ls $d:"; ls -1 "$d" 2>&1 | sed 's/^/  /' >> "$OUT"
done

hr "SECTION 3 :: MODEL ENDPOINT (chat + embeddings availability)"
BASE="${COPILOT_PROVIDER_BASE_URL:-${AZURE_OPENAI_BASE_URL:-}}"
KEY="${COPILOT_PROVIDER_API_KEY:-${AZURE_OPENAI_API_KEY:-}}"
if [ -n "$BASE" ] && [ -n "$KEY" ]; then
  line "base: $BASE"
  if command -v python3 >/dev/null 2>&1; then
    curl -sS --max-time 30 "$BASE/models" -H "api-key: $KEY" 2>/dev/null | python3 -c '
import sys,json
try: d=json.load(sys.stdin)
except Exception as e:
  print("  (could not parse models json:",e,")"); sys.exit(0)
rows=[m for m in d.get("data",[]) if (m.get("capabilities") or {}).get("chat_completion") or (m.get("capabilities") or {}).get("embeddings")]
for m in sorted(rows,key=lambda x:x.get("id","")):
  c=m.get("capabilities") or {}
  print("  %-30s chat=%s embed=%s %s"%(m.get("id"),c.get("chat_completion"),c.get("embeddings"),m.get("lifecycle_status")))
print("  (total models:",len(d.get("data",[])),"| chat/embed-capable:",len(rows),")")
' >> "$OUT" 2>&1
  else
    line "(python3 absent; raw capability lines:)"
    curl -sS --max-time 30 "$BASE/models" -H "api-key: $KEY" 2>/dev/null \
      | tr ',{' '\n\n' | grep -E '"id"|chat_completion|embeddings' | sed 's/^/  /' >> "$OUT"
  fi
else
  line "(no endpoint/key in env — export COPILOT_PROVIDER_BASE_URL and COPILOT_PROVIDER_API_KEY to include this section)"
fi

hr "SECTION 4 :: EXISTING AGENTS (full)"
for f in "$HOME"/.copilot/agents/*.agent.md; do dump "$f" 400; done

hr "SECTION 5 :: EXISTING SKILLS (SKILL.md + SSO guide; NO state/credential files)"
for d in "$HOME"/.copilot/skills/*/; do dump "${d}SKILL.md" 400; done
dump "$HOME/.copilot/skills/webapp-snapshot/SSO_AUTH_GUIDE.md" 400
if [ "${INCLUDE_REFS:-0}" = "1" ]; then
  for r in "$HOME"/.copilot/skills/*/references/*.md; do dump "$r" 200; done
else
  line "(skill reference docs omitted; re-run with INCLUDE_REFS=1 to include them)"
fi
line "(skipped by design: auth_state.json and any *.json state/credential files)"

hr "SECTION 6 :: DIGIT CONFIG (redacted)"
dump "$HOME/.config/digitcode/litellm_config.yaml" 200
line "----- sample.env (keys only, values hidden) -----"
sed -E 's/=.*/=<value-hidden>/' "$HOME/.config/digitcode/sample.env" 2>/dev/null | sed 's/^/  /' >> "$OUT"
line "----- ~/.copilot/settings.json (redacted) -----"
redact < "$HOME/.copilot/settings.json" 2>/dev/null | sed 's/^/  /' >> "$OUT"

hr "SECTION 7 :: DIGIT REGISTRY"
line "dc skill-list:"; dc skill-list 2>&1 | sed 's/^/  /' >> "$OUT"
line "dc agent-list:"; dc agent-list 2>&1 | sed 's/^/  /' >> "$OUT"
line "registry URL hints from launcher:"
if command -v strings >/dev/null 2>&1; then
  strings "$HOME/.local/bin/dc" 2>/dev/null | grep -iE 'https?://|raw\.|github|/agents|/skills' | sort -u | head -30 | sed 's/^/  /' >> "$OUT"
else
  grep -aoE 'https?://[A-Za-z0-9./_-]+' "$HOME/.local/bin/dc" 2>/dev/null | sort -u | head -30 | sed 's/^/  /' >> "$OUT"
fi

hr "END"
line "output: $OUT   ($(wc -l < "$OUT" 2>/dev/null | tr -d ' ') lines)"
printf '\nDONE -> %s\n' "$OUT"
printf 'Open it in VS Code (Word Wrap OFF) and screenshot/OCR each page.\n'
printf 'Line counts are shown per file so we can tell if OCR dropped anything.\n'
