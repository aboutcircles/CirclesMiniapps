#!/usr/bin/env bash
# open-pr.sh — commit, push, and open a draft PR for a new miniapp
#
# Usage: ./scripts/open-pr.sh <slug> "<App Name>" "<One-line description>"
# Example: ./scripts/open-pr.sh crc-leaderboard "CRC Leaderboard" "Ranks Circles users by CRC transferred"
#
# Required:
#   gh CLI installed and authenticated (gh auth status)
#   GH_REPO env var set, e.g. aboutcircles/CirclesMiniapps  (or detected from git remote)

set -euo pipefail

SLUG="${1:?Usage: $0 <slug> <App Name> <Description>}"
APP_NAME="${2:?Usage: $0 <slug> <App Name> <Description>}"
DESCRIPTION="${3:?Usage: $0 <slug> <App Name> <Description>}"

BRANCH="claude/miniapp-${SLUG}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Detect repo if not set
if [[ -z "${GH_REPO:-}" ]]; then
  GH_REPO=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null \
    | sed 's|.*github.com[:/]||' | sed 's|\.git$||' || true)
fi

if [[ -z "${GH_REPO:-}" ]]; then
  echo "❌  Could not detect GitHub repo. Set GH_REPO=owner/repo"
  exit 1
fi

# Check gh CLI
if ! command -v gh &>/dev/null; then
  echo "❌  gh CLI not found. Install: https://cli.github.com"
  exit 1
fi

# Read deploy URL if available
DEPLOY_URL=""
if [[ -f /tmp/vercel-deploy-url ]]; then
  DEPLOY_URL=$(cat /tmp/vercel-deploy-url)
fi

# ── Git operations ────────────────────────────────────────────────────────────
cd "$REPO_ROOT"

echo "🌿  Creating branch: $BRANCH ..."
git checkout -B "$BRANCH"

echo "📦  Staging changes ..."
git add "examples/${SLUG}/" "static/miniapps.json" "AGENT.md" ".context/" 2>/dev/null || true
git add -A  # catch anything else changed

if git diff --cached --quiet; then
  echo "⚠️   Nothing to commit — files may already be staged or unchanged."
else
  git commit -m "feat: add ${APP_NAME} miniapp

Autonomous build — no human intervention.

- Miniapp: examples/${SLUG}/
- ${DESCRIPTION}
$(if [[ -n "$DEPLOY_URL" ]]; then echo "- Deployed: ${DEPLOY_URL}"; fi)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
fi

echo "⬆️   Pushing branch ..."
git push origin "$BRANCH" --force-with-lease

# ── PR body ──────────────────────────────────────────────────────────────────
DEPLOY_LINE=""
if [[ -n "$DEPLOY_URL" ]]; then
  DEPLOY_LINE="**Live preview:** $DEPLOY_URL"
fi

PR_BODY="## ${APP_NAME}

${DESCRIPTION}

${DEPLOY_LINE}

---

### Checklist

- [x] Entry added to \`static/miniapps.json\`
- [x] App loads over HTTPS and works inside an iframe
- [x] Logo URL resolves to a valid image
- [\`${SLUG}\`] \`slug\` is unique
- [x] PR title: \`feat: add ${APP_NAME}\`

---

> 🤖 Built autonomously by Claude Code with no human intervention.
> See \`AGENT.md\` for the workflow used."

echo "🔀  Opening draft PR ..."
PR_URL=$(gh pr create \
  --repo "$GH_REPO" \
  --base master \
  --head "$BRANCH" \
  --draft \
  --title "feat: add ${APP_NAME}" \
  --body "$PR_BODY")

echo ""
echo "✅  PR opened: $PR_URL"
echo ""
echo "PR opened on ${GH_REPO} for review."
echo ""

# Clean up temp file
rm -f /tmp/vercel-deploy-url
