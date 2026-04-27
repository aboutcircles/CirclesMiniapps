#!/usr/bin/env bash
# new-miniapp.sh — scaffold a new miniapp from a template
#
# Usage: ./scripts/new-miniapp.sh <slug> "<Display Name>"
# Example: ./scripts/new-miniapp.sh crc-leaderboard "CRC Leaderboard"

set -euo pipefail

SLUG="${1:?Usage: $0 <slug> <Display Name>}"
NAME="${2:?Usage: $0 <slug> <Display Name>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$REPO_ROOT/examples/$SLUG"
SDK_SRC="$REPO_ROOT/examples/miniapp-sdk.js"

if [[ -d "$TARGET" ]]; then
  echo "❌  Directory already exists: examples/$SLUG"
  exit 1
fi

echo "📁  Scaffolding examples/$SLUG ..."
mkdir -p "$TARGET"

# ── miniapp-sdk.js ─────────────────────────────────────────────────────────
if [[ -f "$SDK_SRC" ]]; then
  cp "$SDK_SRC" "$TARGET/miniapp-sdk.js"
  echo "   ✓ miniapp-sdk.js copied"
else
  echo "   ⚠  miniapp-sdk.js not found at expected path — you must copy it manually"
fi

# ── index.html ─────────────────────────────────────────────────────────────
cat > "$TARGET/index.html" << HTMLEOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${NAME}</title>
  <!-- Gnosis design system fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <div class="title-row">
        <h1>${NAME}</h1>
        <div id="wallet-status" class="badge">Not connected</div>
      </div>
    </header>
    <main id="main-content">
      <div id="disconnected-view" class="view">
        <div class="card empty-state">
          <p>Connect your wallet via the Circles host to use this app.</p>
        </div>
      </div>
      <div id="connected-view" class="view hidden">
        <!-- TODO: main UI -->
      </div>
    </main>
  </div>
  <script type="module" src="main.js"></script>
</body>
</html>
HTMLEOF
echo "   ✓ index.html"

# ── main.js ────────────────────────────────────────────────────────────────
cat > "$TARGET/main.js" << JSEOF
/**
 * ${NAME}
 *
 * SDK pattern:
 *   miniapp-sdk.js  — wallet bridge (transactions, signing)
 *   @aboutcircles/sdk + viem  — read Circles state (profiles, trust, balances)
 */
import { onWalletChange, sendTransactions } from './miniapp-sdk.js';
import { Sdk } from '@aboutcircles/sdk';
import { createPublicClient, http, getAddress } from 'viem';
import { gnosis } from 'viem/chains';

// ── State ──────────────────────────────────────────────────────────────────
let connectedAddress = null;

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http('https://rpc.aboutcircles.com/'),
  cacheTime: 60_000,
  batch: { multicall: { wait: 50 } },
});

// Circles SDK for read operations (no runner needed)
const sdk = new Sdk('https://rpc.aboutcircles.com/', null);

// ── UI helpers ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function showView(id) {
  document.querySelectorAll('.view').forEach((el) => el.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
}

function showToast(message, type = 'info', ms = 4000) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = \`toast \${type}\`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), ms);
}

// ── Initialisation ─────────────────────────────────────────────────────────
async function initializeApp(address) {
  try {
    // TODO: load initial data here
    // Example: const profile = await sdk.rpc.profile.getProfileByAddress(address);
    showView('connected-view');
  } catch (err) {
    console.error('Init error:', err);
    showToast('Failed to load app data', 'error');
  }
}

// ── Wallet connection ──────────────────────────────────────────────────────
onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    $('wallet-status').textContent = 'Not connected';
    showView('disconnected-view');
    return;
  }

  connectedAddress = getAddress(address);
  $('wallet-status').textContent = \`\${connectedAddress.slice(0, 6)}…\${connectedAddress.slice(-4)}\`;
  await initializeApp(connectedAddress);
});
JSEOF
echo "   ✓ main.js"

# ── style.css ──────────────────────────────────────────────────────────────
cat > "$TARGET/style.css" << 'CSSEOF'
/* ── Design tokens — Gnosis design system ──────────────────────────────── */
/* Palette source: Gnosis wallet UI (beige, sage, navy, blue, orange)     */
:root {
  /* Backgrounds — warm beige / cool sage */
  --bg-a: #faf5f1;          /* beige-10 */
  --bg-b: #f6f7f9;          /* sage-10 */

  /* Text */
  --ink: #05061a;            /* navy-970: primary */
  --muted: #51526e;          /* navy-700: secondary */

  /* Surfaces & borders */
  --card: #ffffff;
  --line: #eee7e2;           /* beige-100: default border */
  --line-soft: #f4eee9;      /* beige-50: subtle border */

  /* Brand accent — Gnosis blue */
  --accent: #0e00a8;         /* blue-700: brand */
  --accent-mid: #4335df;     /* blue-500: interactive */
  --accent-soft: #eae8ff;    /* blue-50: tinted background */

  /* Status — success (green) */
  --success-bg: #dcfce7;     /* green-100 */
  --success-line: #bbf7d0;   /* green-200 */
  --success-ink: #145324;    /* green-900 */

  /* Status — warning (amber) */
  --warn-bg: #feebc7;        /* amber-100 */
  --warn-line: #fde68a;      /* amber-200 */
  --warn-ink: #8a482c;       /* amber-900 */

  /* Status — error (red) */
  --error-bg: #fee2e2;       /* red-100 */
  --error-line: #fecaca;     /* red-200 */
  --error-ink: #7f1d1d;      /* red-900 */
}

/* ── Reset & base ───────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: "Space Grotesk", -apple-system, ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1200px 500px at 0% 0%, rgba(14,0,168,0.03) 0%, transparent 65%),
    radial-gradient(900px 500px at 100% 20%, rgba(255,125,62,0.05) 0%, transparent 70%),
    linear-gradient(145deg, var(--bg-a), var(--bg-b));
  min-height: 100vh;
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
}

/* ── Layout ─────────────────────────────────────────────────────────────── */
.app-shell {
  max-width: 720px;
  margin: 0 auto;
  padding: 20px 16px 48px;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.app-header {
  margin-bottom: 20px;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  margin: 0;
  letter-spacing: -0.02em;
  font-size: 30px;
  line-height: 1.1;
}

h2 {
  margin: 22px 0 10px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

/* ── Card ───────────────────────────────────────────────────────────────── */
.card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 22px;
  margin-bottom: 14px;
  box-shadow:
    0 8px 30px rgba(26, 35, 64, 0.08),
    inset 0 1px 0 #ffffff;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
button, .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  border: 0;
  border-radius: 999px;
  padding: 12px 16px;
  background: linear-gradient(130deg, var(--accent), var(--accent-mid));
  color: #ffffff;
  font-family: inherit;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  white-space: nowrap;
}
button:disabled, .btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button:active:not(:disabled), .btn:active:not(:disabled) {
  transform: scale(0.97);
}

.btn-secondary {
  background: #ffffff;
  border: 1px solid var(--line);
  color: var(--ink);
}

.btn-danger {
  background: linear-gradient(130deg, var(--error-ink), #ef4444);
  color: #fff;
}

.btn-inline {
  width: auto;
  padding: 8px 14px;
  font-size: 13px;
}

/* ── Form fields ─────────────────────────────────────────────────────────── */
.field {
  margin-top: 10px;
}

.field label {
  display: block;
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.field input,
.field textarea,
.field select {
  width: 100%;
  border-radius: 11px;
  border: 1px solid var(--line-soft);
  background: #ffffff;
  color: var(--ink);
  padding: 11px 12px;
  font-family: "JetBrains Mono", "SF Mono", "Menlo", monospace;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.field input:focus,
.field textarea:focus {
  border-color: var(--accent-mid);
}

/* ── Badges ─────────────────────────────────────────────────────────────── */
.badge {
  border-radius: 999px;
  border: 1px solid var(--line);
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  background: rgba(255,255,255,0.7);
  color: var(--muted);
}
.badge-success {
  background: var(--success-bg);
  border-color: var(--success-line);
  color: var(--success-ink);
}
.badge-warn {
  background: var(--warn-bg);
  border-color: var(--warn-line);
  color: var(--warn-ink);
}
.badge-error {
  background: var(--error-bg);
  border-color: var(--error-line);
  color: var(--error-ink);
}

/* ── Result / alert blocks ───────────────────────────────────────────────── */
.result {
  border-radius: 12px;
  border: 1px solid var(--line);
  padding: 14px 16px;
  font-size: 14px;
  margin-top: 12px;
}
.result-success { background: var(--success-bg); border-color: var(--success-line); color: var(--success-ink); }
.result-warn    { background: var(--warn-bg);    border-color: var(--warn-line);    color: var(--warn-ink);    }
.result-error   { background: var(--error-bg);   border-color: var(--error-line);   color: var(--error-ink);   }

/* ── Utility ─────────────────────────────────────────────────────────────── */
.hidden { display: none !important; }

.loading {
  opacity: 0.55;
  pointer-events: none;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--muted);
  font-size: 14px;
}

/* ── Toast ───────────────────────────────────────────────────────────────── */
.toast {
  position: fixed;
  bottom: 1.25rem;
  right: 1.25rem;
  background: var(--ink);
  color: #fff;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 13px;
  max-width: 22rem;
  z-index: 9999;
  box-shadow: 0 8px 24px rgba(26, 35, 64, 0.18);
  animation: slide-in 0.2s ease;
}
.toast.error   { background: #b42318; }
.toast.success { background: #157a2f; }
@keyframes slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 560px) {
  h1 { font-size: 22px; }
  .app-shell { padding: 14px 12px 32px; }
  .card { padding: 16px; border-radius: 16px; }
}
CSSEOF
echo "   ✓ style.css"

# ── package.json ───────────────────────────────────────────────────────────
cat > "$TARGET/package.json" << PKGJSONEOF
{
  "name": "${SLUG}",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@aboutcircles/sdk": "^0.1.24",
    "@aboutcircles/sdk-utils": "^0.1.24",
    "@safe-global/safe-deployments": "^1.37.22",
    "viem": "^2.46.3"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vite-plugin-node-polyfills": "^0.25.0"
  }
}
PKGJSONEOF
echo "   ✓ package.json"

# ── vite.config.js ─────────────────────────────────────────────────────────
cat > "$TARGET/vite.config.js" << VITEEOF
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  optimizeDeps: {
    esbuildOptions: { define: { global: 'globalThis' } },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
});
VITEEOF
echo "   ✓ vite.config.js"

# ── vercel.json ────────────────────────────────────────────────────────────
cat > "$TARGET/vercel.json" << VERJSONEOF
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": null,
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
VERJSONEOF
echo "   ✓ vercel.json"

# ── .gitignore ─────────────────────────────────────────────────────────────
cat > "$TARGET/.gitignore" << GITEOF
node_modules/
dist/
.env
.env.local
.vercel
GITEOF
echo "   ✓ .gitignore"

# ── README.md ──────────────────────────────────────────────────────────────
cat > "$TARGET/README.md" << READMEEOF
# ${NAME}

> A Circles MiniApp.

## Overview

<!-- TODO: one paragraph describing what this app does and why -->

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

Load it in the Circles MiniApp host via the Advanced tab at \`https://circles.gnosis.io/miniapps\`.

## Deployment

\`\`\`bash
# From repo root:
./scripts/deploy-miniapp.sh examples/${SLUG}
\`\`\`

## Architecture

- **Wallet bridge**: \`miniapp-sdk.js\` — postMessage protocol for transactions and signing
- **Circles reads**: \`@aboutcircles/sdk\` — profiles, trust, balances, RPC queries
- **Chain**: Gnosis Chain (ID 100)
READMEEOF
echo "   ✓ README.md"

echo ""
echo "✅  Scaffolded examples/${SLUG}/"
echo ""
echo "Next steps:"
echo "  1. cd examples/${SLUG} && npm install"
echo "  2. Implement your feature in main.js"
echo "  3. Run: ./scripts/deploy-miniapp.sh examples/${SLUG}"
