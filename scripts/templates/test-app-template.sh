#!/usr/bin/env bash
#
# templates/app is the starter every new bitbaum product is created from. A
# defect in it is not one broken repo — it is every repo created from then on,
# and the fleet ratchets then report it once per repo, forever. So it is
# rendered and checked on every fleet PR, the same way a product would be.
#
#   scripts/templates/test-app-template.sh            # contract checks, no install
#   scripts/templates/test-app-template.sh --full     # + pnpm install, verify
#   DATABASE_URL=postgres://…/x_test … --full         # + the integration suite
#
# The contract checks reuse the fleet's own judges — version-currency's
# gapsFor, the verify-floor predicates, the CI/CD hygiene audit — rather than
# restating their rules, so the template is held to exactly what every
# product created from it will be held to.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  ✗ %s\n' "$1"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/starter-check"

echo "templates/app"

# ── it renders, completely ───────────────────────────────────────────────────
if bash "$HERE/render-app.sh" starter-check "$APP" --title "Starter Check" >/dev/null; then
  ok "renders with every placeholder filled"
else
  bad "does not render"
  echo "passed $pass, failed $fail"
  exit 1
fi

# The renderer must refuse a title that could close a string literal.
if bash "$HERE/render-app.sh" bad-title "$WORK/bad" --title 'x"; evil()' >/dev/null 2>&1; then
  bad "the renderer accepted a title with a quote in it"
else
  ok "the renderer refuses a title that could break out of a string"
fi

[ -f "$APP/.gitignore" ] && [ ! -e "$APP/gitignore" ] && ok "ships .gitignore" || bad "no .gitignore after rendering"
[ -f "$APP/pnpm-lock.yaml" ] && ok "ships a resolved lockfile (CI and the box install frozen)" \
  || bad "no pnpm-lock.yaml — --frozen-lockfile would refuse to install"

# ── the blessed stack, at the blessed majors ─────────────────────────────────
# Paths go through the environment, not argv: version-currency.mjs runs its
# fleet-wide sweep when argv[1] names it, which an `-e` script's argv[1] would.
if AUDIT="$ROOT/scripts/ci/version-currency.mjs" BLESSED="$ROOT/scripts/ci/blessed-versions.json" \
   MANIFEST="$APP/package.json" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const { gapsFor } = await import(process.env.AUDIT);
  const blessed = JSON.parse(readFileSync(process.env.BLESSED, "utf8"));
  const pkg = JSON.parse(readFileSync(process.env.MANIFEST, "utf8"));
  const gaps = gapsFor(pkg, blessed);
  for (const g of gaps) console.error("    " + g);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const missing = ["next","react","typescript","tailwindcss","zod","eslint","vitest","prettier","better-auth","pg","@bitbaum/ai-kit","@bitbaum/design-tokens"].filter((k) => !(k in deps));
  for (const m of missing) console.error("    not installed: " + m);
  process.exit(gaps.length + missing.length === 0 ? 0 : 1);
';  then
  ok "version-currency: zero gaps against blessed-versions.json"
else
  bad "version-currency gaps (above) — the starter must be at the blessed majors"
fi

pkg_field() { node -e 'const p=require(process.argv[1]); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],p); process.stdout.write(v==null?"":String(v))' "$APP/package.json" "$1"; }
[[ "$(pkg_field packageManager)" =~ ^pnpm@11\.[0-9]+\.[0-9]+$ ]] && ok "packageManager pins pnpm 11" || bad "packageManager is not an exact pnpm 11 pin"
[ "$(tr -d '[:space:]' < "$APP/.nvmrc")" = "24" ] && ok ".nvmrc is Node 24" || bad ".nvmrc is not Node 24"

# ── the verify contract (fleet verify-floor-audit.sh) ────────────────────────
# shellcheck source=../ci/verify-predicates.sh
. "$ROOT/scripts/ci/verify-predicates.sh"
verify="$(pkg_field scripts.verify)"
ci="$(cat "$APP/.github/workflows/ci.yml")"
for gate in format:check lint typecheck test build; do
  grep -qE "pnpm run ${gate}( |$)" <<<"$verify" && ok "verify runs $gate" || bad "verify does not run $gate"
done
verify_softens_itself "$verify" && bad "verify softens itself (|| true / --if-present)" || ok "verify cannot pass by skipping a gate"
ci_invokes_verify "$ci" && ok "CI runs pnpm run verify" || bad "CI does not run verify"
ci_verify_softened "$ci" && bad "CI softens verify with --if-present" || ok "CI runs verify unsoftened"
grep -q 'continue-on-error: *true' "$APP/.github/workflows/ci.yml" && bad "CI discards a gate with continue-on-error" \
  || ok "no gate in CI is allowed to fail quietly"

# ── the workflows (fleet cicd-hygiene-audit.sh, the same judge as every repo) ─
HYG="$WORK/hygiene"
mkdir -p "$HYG/app/workflows" && cp "$APP"/.github/workflows/*.yml "$HYG/app/workflows/" && : > "$HYG/app/.is-next"
hyg="$(CICD_HYGIENE_FIXTURE_DIR="$HYG" bash "$ROOT/scripts/ci/cicd-hygiene-audit.sh" 2>&1)"
if awk 'NF==2 && $2 ~ /^[0-9]+$/ && $2 > 0 { bad=1 } END { exit bad }' <<<"$hyg"; then
  ok "CI/CD hygiene audit: zero findings"
else
  bad "CI/CD hygiene findings:"
  printf '%s\n' "$hyg" | sed 's/^/      /'
fi
for wf in ci auto-merge deploy live-check codeql secret-scan dependency-audit; do
  if python3 -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); assert d.get('name') and (d.get('on') or d.get(True))" \
       "$APP/.github/workflows/$wf.yml" 2>/dev/null; then
    ok "$wf.yml parses and has a name and a trigger"
  else
    bad "$wf.yml is missing or does not parse"
  fi
done
[ -f "$APP/.github/dependabot.yml" ] && ok "ships a Dependabot config" || bad "no .github/dependabot.yml"
grep -q 'sha256sum -c' "$APP/.github/workflows/secret-scan.yml" && ok "the secret scanner is checksum-pinned" \
  || bad "the secret scanner download is not verified"
if grep -q 'useDefault = true' "$APP/.gitleaks.toml" 2>/dev/null; then
  ok "gitleaks keeps its default rules (.gitleaks.toml only adds the NEXT_PUBLIC_ allowance)"
else
  bad ".gitleaks.toml missing or drops gitleaks' default rules"
fi
if grep -rhoE 'uses: actions/(checkout|setup-node)@v[1-6]\b' "$APP/.github/workflows"; then
  bad "a workflow pins a stale checkout/setup-node (the fleet is on v7)"
else
  ok "no stale action versions"
fi

# ── docs agents read, and the secrets an operator must know about ────────────
grep -q 'bitbaum/fleet' "$APP/AGENTS.md" && ok "AGENTS.md points at fleet AGENTS.md" || bad "AGENTS.md lacks the fleet pointer"
grep -q 'AGENTS.md' "$APP/CLAUDE.md" && ok "CLAUDE.md points at AGENTS.md" || bad "CLAUDE.md does not point at AGENTS.md"
for f in README.md ROADMAP.md CHANGELOG.md LICENSE .env.example; do
  [ -s "$APP/$f" ] && ok "ships $f" || bad "missing $f"
done
# Every env var the code reads is named in .env.example (fleet bus-factor-audit).
read_vars="$(grep -rhoE 'env(\.|\[")[A-Z][A-Z0-9_]+' "$APP"/{lib,app,components,proxy.ts,next.config.ts} 2>/dev/null \
  | sed -E 's/^env(\.|\[")//' | sort -u | grep -vE '^(NODE_ENV|GITHUB_SHA|BUILD_COMMIT)$')"
unnamed=""
while IFS= read -r v; do
  [ -n "$v" ] || continue
  grep -qE "^${v}=" "$APP/.env.example" || unnamed="$unnamed $v"
done <<<"$read_vars"
[ -z "$unnamed" ] && ok "every env var the code reads is named in .env.example" \
  || bad "read but not named in .env.example:$unnamed"

# ── security invariants a refactor must not lose ─────────────────────────────
grep -q "'strict-dynamic'" "$APP/lib/security.ts" && grep -q "connect-src 'self'" "$APP/lib/security.ts" \
  && ok "CSP: nonce + strict-dynamic, connect-src 'self'" || bad "the CSP lost strict-dynamic or connect-src 'self'"
grep -q 'max-age=63072000' "$APP/lib/security.ts" && ok "HSTS for two years" || bad "HSTS is not two years"
if node "$ROOT/scripts/ci/package-composition-audit.mjs" --dir "$APP"; then
  ok "shared product building blocks are installed and wired"
else
  bad "shared package composition is incomplete"
fi
grep -q 'createAuthRuntime' "$APP/lib/auth/server.ts" && grep -q '@bitbaum/accountkit/auth/next' "$APP/lib/auth/server.ts" \
  && ok "accountkit owns role input, explicit linking, OIDC and authentication limits" || bad "authentication runtime is duplicated locally"
grep -q '@bitbaum/accountkit/auth/schema' "$APP/lib/db/schema.ts" && ok "account tables use the shared schema" || bad "account schema is duplicated"
grep -q 'localePrefix: "always"' "$APP/i18n/routing.ts" && ok 'next-intl localePrefix: "always"' || bad "localePrefix is not always"
if grep -q 'ß' "$APP/messages/de.json"; then bad "German messages contain ß (Swiss spelling: ss)"; else ok "German is spelled the Swiss way"; fi

# ── it installs, verifies and (with a database) signs people in ──────────────
if [ "$FULL" = 1 ]; then
  if (cd "$APP" && git init -q && pnpm install --frozen-lockfile >"$WORK/install.log" 2>&1); then
    ok "pnpm install --frozen-lockfile"
  else
    bad "install failed:"; tail -30 "$WORK/install.log" | sed 's/^/      /'
  fi
  if (cd "$APP" && NEXT_TELEMETRY_DISABLED=1 pnpm run verify >"$WORK/verify.log" 2>&1); then
    ok "pnpm run verify (format, lint, typecheck, test, build)"
  else
    bad "verify failed:"; tail -60 "$WORK/verify.log" | sed 's/^/      /'
  fi
  # drizzle/ must be exactly what lib/db/schema.ts generates: a schema edit
  # without its migration would deploy code against tables that do not exist.
  # This also runs drizzle-kit itself, so its toolchain is proven to work.
  if gen="$(cd "$APP" && pnpm exec drizzle-kit generate --name drift-check 2>&1)" \
     && grep -q 'No schema changes' <<<"$gen"; then
    ok "drizzle/ is exactly what lib/db/schema.ts generates"
  else
    bad "lib/db/schema.ts and drizzle/ disagree (or drizzle-kit failed):"
    printf '%s\n' "$gen" | tail -15 | sed 's/^/      /'
  fi
  if [ -n "${DATABASE_URL:-}" ]; then
    if (cd "$APP" && pnpm run test:integration >"$WORK/integration.log" 2>&1); then
      ok "accounts end to end against Postgres (pnpm run test:integration)"
    else
      bad "integration failed:"; tail -60 "$WORK/integration.log" | sed 's/^/      /'
    fi
  else
    echo "  - integration suite not run: no DATABASE_URL (CI provides one)"
  fi
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
