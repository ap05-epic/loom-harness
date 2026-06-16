#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Loom Harness — one-shot pod setup (Hermes-style).
#
# Takes a fresh clone to a verified install: bootstraps pnpm, installs, builds,
# makes `loom` available on PATH (with a robust fallback for pods where
# `pnpm link --global` has no global bin dir), creates a profile OUTSIDE the
# clone, and runs `doctor` + `models test`. Idempotent — safe to re-run.
#
# No secrets or internal URLs are baked in: the base URL + key come from flags,
# the environment (LLM_BASE_URL / LLM_API_KEY), or an interactive prompt.
#
# Usage:
#   bash scripts/setup-pod.sh [options]
#
# Options (all optional; env vars in parens are the fallback):
#   --data-dir <path>   profile/data dir, OUTSIDE the clone  (LOOM_DATA_DIR)
#   --project  <name>   project name                         (default: first-project)
#   --model    <id>     default model id                     (LLM_MODEL, default gpt-5.4)
#   --driver   <name>   openai | copilot | anthropic         (default: auto)
#   --base-url <url>    OpenAI/Azure base URL (…/openai/v1)   (LLM_BASE_URL)
#   --api-key  <key>    OpenAI/Azure API key                  (LLM_API_KEY)
#   --with-browser      also run `npx playwright install chromium`
#   -h, --help          show this help
# ---------------------------------------------------------------------------
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

step() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓ %s\033[0m\n' "$*"; }
info() { printf '  \033[0;36mi %s\033[0m\n' "$*"; }
warn() { printf '  \033[1;33m! %s\033[0m\n' "$*"; }
fail() { printf '  \033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

# ---- options -------------------------------------------------------------
DATA_DIR="${LOOM_DATA_DIR:-$HOME/loom-data/first-project}"
PROJECT="first-project"
MODEL="${LLM_MODEL:-gpt-5.4}"
DRIVER=""
BASE_URL="${LLM_BASE_URL:-}"
API_KEY="${LLM_API_KEY:-}"
WITH_BROWSER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --project)  PROJECT="$2"; shift 2 ;;
    --model)    MODEL="$2"; shift 2 ;;
    --driver)   DRIVER="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --api-key)  API_KEY="$2"; shift 2 ;;
    --with-browser) WITH_BROWSER=1; shift ;;
    -h|--help) sed -n '3,/^# ---/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option: $1 (try --help)" ;;
  esac
done

# The script always drives the CLI through the built entrypoint, so it works
# regardless of whether the global link below succeeds.
loom_run() { node "$here/packages/cli/dist/bin.js" "$@"; }

# ---- 0. preflight --------------------------------------------------------
step "0. Preflight (node, git, data dir outside the clone)"
command -v node >/dev/null 2>&1 || fail "node not found — install Node.js >= 20.11"
command -v git  >/dev/null 2>&1 || fail "git not found"
case "$DATA_DIR" in
  "$here"|"$here"/*) fail "data dir must live OUTSIDE the clone (project data never enters git): $DATA_DIR" ;;
esac
ok "node $(node --version), git present"
info "data dir: $DATA_DIR"

# ---- 1. pnpm via corepack -----------------------------------------------
step "1. Bootstrap pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || npm i -g pnpm >/dev/null 2>&1 || fail "could not bootstrap pnpm (try: corepack enable)"
fi
ok "pnpm $(pnpm --version)"

# ---- 2. install ----------------------------------------------------------
step "2. Install dependencies"
# better-sqlite3's native build can fail on a locked-down pod (no compiler); the
# adapter falls back to node:sqlite at runtime, so --ignore-scripts is a fine retry.
if pnpm install --frozen-lockfile >/dev/null 2>&1; then
  ok "installed (--frozen-lockfile)"
elif pnpm install --frozen-lockfile --ignore-scripts >/dev/null 2>&1; then
  ok "installed (--frozen-lockfile --ignore-scripts; native builds skipped — node:sqlite covers it)"
else
  fail "pnpm install failed — check the package mirror / proxy"
fi

# ---- 3. build ------------------------------------------------------------
step "3. Build"
pnpm build >/dev/null 2>&1 || fail "pnpm build failed"
ok "built all packages"

# ---- 4. make 'loom' available globally ----------------------------------
step "4. Put 'loom' on your PATH"
if pnpm link --global "$here/packages/cli" >/dev/null 2>&1 && command -v loom >/dev/null 2>&1; then
  ok "linked via pnpm — 'loom' is on your PATH"
else
  mkdir -p "$HOME/.local/bin"
  cat > "$HOME/.local/bin/loom" <<EOF
#!/usr/bin/env bash
exec node "$here/packages/cli/dist/bin.js" "\$@"
EOF
  chmod +x "$HOME/.local/bin/loom"
  ok "wrote wrapper ~/.local/bin/loom"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) : ;;
    *)
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
      warn "added ~/.local/bin to PATH in ~/.bashrc — run 'source ~/.bashrc' or open a new shell"
      ;;
  esac
fi

# ---- 5. optional: Playwright Chromium -----------------------------------
if [ "$WITH_BROWSER" = "1" ]; then
  step "5. Install Playwright Chromium"
  npx playwright install chromium >/dev/null 2>&1 && ok "chromium installed" || warn "could not install chromium (the pod may already have it cached)"
fi

# ---- 6. choose the provider ---------------------------------------------
step "6. Model provider"
if [ -z "$DRIVER" ]; then
  if [ -n "$API_KEY" ]; then
    DRIVER="openai"
  elif [ -t 0 ]; then
    printf '  Provider:  [1] OpenAI/Azure key (recommended)   [2] GitHub Copilot login\n'
    read -r -p "  Choose 1 or 2 [1]: " _choice
    case "${_choice:-1}" in 2) DRIVER="copilot" ;; *) DRIVER="openai" ;; esac
  else
    DRIVER="copilot"
  fi
fi
if [ "$DRIVER" = "openai" ]; then
  [ -z "$BASE_URL" ] && [ -t 0 ] && read -r -p "  LLM_BASE_URL (…/openai/v1): " BASE_URL
  if [ -z "$API_KEY" ] && [ -t 0 ]; then read -r -s -p "  LLM_API_KEY: " API_KEY; printf '\n'; fi
fi
ok "driver: $DRIVER"

# ---- 7. create the profile (idempotent) ---------------------------------
step "7. Create the profile"
if [ -f "$DATA_DIR/loom.config.yaml" ]; then
  info "profile already exists at $DATA_DIR — keeping it"
else
  loom_run init --dir "$DATA_DIR" --project "$PROJECT" --model "$MODEL" --driver "$DRIVER" --no-input
  ok "wrote $DATA_DIR/loom.config.yaml"
fi

# Fill the .env with the real key/URL only when provided (never clobber with blanks).
if [ "$DRIVER" = "openai" ] && [ -n "$API_KEY" ]; then
  mkdir -p "$DATA_DIR"
  cat > "$DATA_DIR/.env" <<EOF
# Loom — direct OpenAI/Azure endpoint (written by setup-pod.sh). Keep this file private.
LLM_BASE_URL=$BASE_URL
LLM_API_KEY=$API_KEY
EOF
  chmod 600 "$DATA_DIR/.env"
  ok "wrote $DATA_DIR/.env (LLM_BASE_URL + LLM_API_KEY, mode 600)"
elif [ "$DRIVER" = "copilot" ]; then
  info "Copilot login: run 'copilot login' (or 'dc login') before the first model call"
fi

# ---- 8. doctor + a live model probe -------------------------------------
step "8. Verify"
loom_run doctor --data-dir "$DATA_DIR" || warn "doctor reported issues — review the output above"
if [ "$DRIVER" = "openai" ] && [ -z "$API_KEY" ]; then
  warn "no API key set — fill LLM_API_KEY in $DATA_DIR/.env, then run: loom models test --profile $DATA_DIR"
else
  loom_run models test --profile "$DATA_DIR" || warn "model probe failed — check creds (openai) or run 'copilot login' (copilot)"
fi

# ---- done ----------------------------------------------------------------
step "Done — Loom Harness is set up"
cat <<EOF

  profile:   $DATA_DIR
  driver:    $DRIVER   model: $MODEL

  Next:
    loom next --data-dir $DATA_DIR        # what to do now
    loom ask  --profile  $DATA_DIR "say pong"
    loom map  --data-dir $DATA_DIR        # begin mapping a legacy app

  (If you used the wrapper, open a new shell or 'source ~/.bashrc' so 'loom' resolves.)
EOF
