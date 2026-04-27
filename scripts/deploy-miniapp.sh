#!/usr/bin/env bash
# deploy-miniapp.sh — build and deploy a miniapp to Vercel
#
# Usage: ./scripts/deploy-miniapp.sh examples/<slug>
# Output: prints the deployment URL on success
#
# Requirements:
#   vercel CLI installed and authenticated (vercel whoami)
#   VERCEL_ORG_ID — (optional) Vercel team/org ID; omit for personal accounts
#   VERCEL_PROJECT_PREFIX — (optional) prefix for project names, default: "circles-miniapp"

set -euo pipefail

MINIAPP_DIR="${1:?Usage: $0 examples/<slug>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ABS_DIR="$REPO_ROOT/$MINIAPP_DIR"
SLUG="$(basename "$ABS_DIR")"
PROJECT_PREFIX="${VERCEL_PROJECT_PREFIX:-circles-miniapp}"
PROJECT_NAME="${PROJECT_PREFIX}-${SLUG}"

# ── Checks ───────────────────────────────────────────────────────────────────
if ! command -v vercel &>/dev/null; then
  echo "❌  vercel CLI not found. Install it: npm install -g vercel"
  exit 1
fi

if ! vercel whoami &>/dev/null; then
  echo "❌  Not logged in to Vercel. Run: vercel login"
  exit 1
fi

if [[ ! -d "$ABS_DIR" ]]; then
  echo "❌  Directory not found: $MINIAPP_DIR"
  exit 1
fi

if [[ ! -f "$ABS_DIR/package.json" ]]; then
  echo "❌  No package.json found in $MINIAPP_DIR"
  exit 1
fi

echo "🔨  Building $SLUG ..."
cd "$ABS_DIR"
npm install --silent
npm run build

# ── vercel.json (create if missing) ─────────────────────────────────────────
if [[ ! -f "$ABS_DIR/vercel.json" ]]; then
  echo "   Creating vercel.json ..."
  cat > "$ABS_DIR/vercel.json" << EOF
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": null,
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
EOF
fi

# ── Deploy ───────────────────────────────────────────────────────────────────
echo "🚀  Deploying to Vercel (project: $PROJECT_NAME) ..."

VERCEL_ARGS=(
  --name "$PROJECT_NAME"
  --yes
  --prod
)

if [[ -n "${VERCEL_ORG_ID:-}" ]]; then
  VERCEL_ARGS+=(--scope "$VERCEL_ORG_ID")
fi

# Use VERCEL_TOKEN if set, otherwise rely on vercel login session
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  VERCEL_ARGS+=(--token "$VERCEL_TOKEN")
fi

DEPLOY_URL=$(vercel "${VERCEL_ARGS[@]}" 2>&1 | grep -E '^https://' | tail -1)

if [[ -z "$DEPLOY_URL" ]]; then
  echo "❌  Deployment failed — no URL returned. Check vercel login status."
  exit 1
fi

echo ""
echo "✅  Deployed: $DEPLOY_URL"
echo ""

# ── Auto-disable Vercel Deployment Protection ────────────────────────────────
# Without this, the miniapp returns 401 inside the Gnosis wallet iframe.
echo "🔓  Disabling Deployment Protection ..."
PROTECT_ARGS=(--protection none)
[[ -n "${VERCEL_TOKEN:-}" ]] && PROTECT_ARGS+=(--token "$VERCEL_TOKEN")
[[ -n "${VERCEL_ORG_ID:-}" ]] && PROTECT_ARGS+=(--scope "$VERCEL_ORG_ID")
if vercel project update "$PROJECT_NAME" "${PROTECT_ARGS[@]}" 2>/dev/null; then
  echo "   Protection disabled."
else
  echo "⚠️  Could not auto-disable protection. Do it manually:"
  echo "   Project Settings → Deployment Protection → Disabled"
fi

echo ""
echo "Next steps:"
echo "  1. Add this URL to static/miniapps.json"
echo "  2. Run: ./scripts/open-pr.sh $SLUG \"<App Name>\" \"<Description>\""
echo ""

# Write URL to a temp file so CI/other scripts can read it
echo "$DEPLOY_URL" > /tmp/vercel-deploy-url
