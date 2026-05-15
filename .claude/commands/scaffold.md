Scaffold a new Circles MiniApp directory. Usage: `/scaffold <slug> "<Display Name>"`

The argument is a slug and display name, e.g. `/scaffold crc-leaderboard "CRC Leaderboard"`

---

Create the standalone miniapp directory and all required files using the patterns in `.agents/docs/` (referenced per step below). See `AGENTS.md` → "Standalone vs embedded miniapps" for the model this produces.

## Steps

1. **Create directory**
   ```bash
   mkdir -p examples/<slug>
   ```

2. **Create `examples/<slug>/index.html`** — use Pattern H (UI shell) from `@.agents/docs/ui-shell.md`, replacing the title and heading with the display name.

3. **Create `examples/<slug>/main.js`** — use Pattern A (wallet connection) from `@.agents/docs/wallet.md` as the base. Include the helpers (`$`, `showView`, `showToast`) and the `onWalletChange` handler. Leave a `// TODO: load initial data here` placeholder.

4. **Create `examples/<slug>/style.css`** — use the full design-system CSS from `@.agents/docs/design.md`. Include all tokens, reset, layout, header, card, button, badge, field, result, toast, and responsive styles.

5. **Create `examples/<slug>/package.json`** — use Pattern J from `@.agents/docs/ui-shell.md` with `"name"` set to the slug.

6. **Create `examples/<slug>/vite.config.js`** — use Pattern K from `@.agents/docs/ui-shell.md`.

7. **Create `examples/<slug>/vercel.json`**:
   ```json
   {
     "buildCommand": "npm run build",
     "outputDirectory": "dist",
     "framework": null,
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```

8. **Create `examples/<slug>/.gitignore`**:
   ```
   node_modules/
   dist/
   .env
   .env.local
   .vercel
   ```

9. **Install dependencies**:
   ```bash
   cd examples/<slug> && npm install
   ```
