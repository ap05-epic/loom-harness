#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Loom Harness — offline rehearsal (blocked-internet pod dry-run)
#
# Proves the harness installs, builds, self-checks, runs the full fixture
# pipeline, and updates across two release tags WITHOUT public-internet egress
# (only the package mirror + the LLM endpoint, both reachable on the pod). Run
# this on a fresh checkout before trusting an autonomous shift on the pod.
#
# What it exercises (the M8/L8 definition-of-done):
#   install (frozen/offline) → build → doctor → fixture MAP→…→EVAL → update v→v
#
# Usage:
#   FROM_TAG=v1.0.0 TO_TAG=v1.0.1 bash scripts/offline-rehearsal.sh
#   OFFLINE=1 ...   # add --offline to pnpm (pure store, no network at all)
#
# Env:
#   FROM_TAG / TO_TAG   the two tags to rehearse `loom update` across (optional)
#   OFFLINE=1           install from the pnpm store only (no mirror either)
#   DATA_DIR            scratch data dir (default: a fresh mktemp outside the clone)
# ---------------------------------------------------------------------------
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

DATA_DIR="${DATA_DIR:-$(mktemp -d -t loom-rehearsal-XXXX)}"
install_flags="--frozen-lockfile"
[ "${OFFLINE:-0}" = "1" ] && install_flags="--offline"

step() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓ %s\033[0m\n' "$*"; }
fail() { printf '  \033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

step "0. Preconditions (pnpm via corepack; data dir outside the clone)"
command -v pnpm >/dev/null 2>&1 || corepack enable || fail "pnpm absent — run: corepack enable (or npm i -g pnpm)"
case "$DATA_DIR" in "$here"*) fail "DATA_DIR must live OUTSIDE the clone (bank data never enters git)";; esac
ok "pnpm $(pnpm --version), data dir $DATA_DIR"

step "1. Install ($install_flags)"
pnpm install "$install_flags" || fail "install failed (check the Nexus mirror / pnpm store)"
ok "dependencies installed"

step "2. Build"
pnpm build || fail "build failed"
ok "all packages built"

step "3. Test suite (mock-LLM; no network)"
pnpm vitest run >/dev/null 2>&1 || fail "test suite red"
ok "tests green"

step "4. loom doctor (node / sqlite / git / pnpm / jdk / browser / copilot)"
node packages/cli/dist/bin.js doctor || fail "doctor reported a blocking failure"
ok "environment healthy"

step "5. Full fixture pipeline (MAP → CRAWL → BUILD → EVAL) on the bundled profile"
node packages/cli/dist/bin.js run --profile profiles/fixture --data-dir "$DATA_DIR" --json >"$DATA_DIR/run.json" \
  || fail "fixture pipeline did not complete"
grep -q '"ok":true' "$DATA_DIR/run.json" || fail "fixture run did not report ok"
ok "fixture rebuilt + evaluated end-to-end"

if [ -n "${FROM_TAG:-}" ] && [ -n "${TO_TAG:-}" ]; then
  step "6. Update loop: $FROM_TAG → $TO_TAG (forward-only migrations, state preserved)"
  git checkout "$FROM_TAG" --quiet || fail "tag $FROM_TAG not found"
  pnpm install "$install_flags" >/dev/null && pnpm build >/dev/null
  node packages/cli/dist/bin.js update --to "$TO_TAG" --data-dir "$DATA_DIR" \
    || fail "update $FROM_TAG → $TO_TAG failed"
  ok "updated across tags; data dir intact"
else
  step "6. Update loop — skipped (set FROM_TAG + TO_TAG to rehearse it)"
fi

printf '\n\033[1;32m✓ Offline rehearsal passed.\033[0m  Scratch data: %s\n' "$DATA_DIR"
